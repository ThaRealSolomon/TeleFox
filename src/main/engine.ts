import { app, safeStorage, clipboard, dialog, Session, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { randomUUID } from 'node:crypto'
import * as S from '../shared/proxy'
import { openTunnel, probe, rd, Target } from './tunnel'

type P = S.ProxyEntry
export const db = { failover: true, threshold: 3, cooldownSec: 30, fallbackDirect: false, homepage: 'https://duckduckgo.com', activeId: null as string | null }
export const proxies = new Map<string, P>()
let ses: Session
let getWin: () => BrowserWindow | undefined = () => undefined
let active: P | null = null
let route: { ok: boolean; ms?: number; at: number; via: string } | null = null
let notice = { id: 0, text: '' }
let version = 0, progress: { total: number; done: number; working: number; failed: number; testing: number } | null = null

// ---------- persistence (batched) ----------
const file = () => path.join(app.getPath('userData'), 'telefox.json')
const enc = (s?: string) => (s ? (safeStorage.isEncryptionAvailable() ? 'e:' + safeStorage.encryptString(s).toString('base64') : 'p:' + s) : undefined)
const dec = (s?: string) => (!s ? undefined : s.startsWith('e:') ? safeStorage.decryptString(Buffer.from(s.slice(2), 'base64')) : s.slice(2))
let saveT: NodeJS.Timeout | undefined
export const flushNow = () => { if (saveT) clearTimeout(saveT); saveT = undefined; try { fs.writeFileSync(file(), JSON.stringify({ ...db, proxies: [...proxies.values()] })) } catch { console.error('save failed') } }
const saveSoon = () => { if (!saveT) saveT = setTimeout(flushNow, 1000) }
export function loadDb() {
  try {
    const j = JSON.parse(fs.readFileSync(file(), 'utf8'))
    for (const k of Object.keys(db) as (keyof typeof db)[]) if (j[k] !== undefined) (db as any)[k] = j[k]
    for (const e of j.proxies ?? []) {
      if (e.kind) { e.protocol = e.kind; e.host = e.server; e.successes = 0; e.source = 'Telegram'; e.updatedAt = e.createdAt; e.id = S.idOf(e) }
      if (e.protocol && e.host) proxies.set(e.id, e)
    }
  } catch { /* first launch */ }
}
let notT: NodeJS.Timeout | undefined
export function notify() {
  version++
  if (notT) return
  notT = setTimeout(() => { notT = undefined; getWin()?.webContents.send('state', publicState()) }, 200)
}
const say = (text: string) => { notice = { id: notice.id + 1, text }; notify() }
const publicState = () => ({ version, activeId: db.activeId, active: active ? { protocol: active.protocol, host: active.host, port: active.port, latency: active.latency } : null, route, progress, notice, settings: { failover: db.failover, threshold: db.threshold, cooldownSec: db.cooldownSec, fallbackDirect: db.fallbackDirect } })
const tgt = (p: P): Target => ({ protocol: p.protocol, host: p.host, port: p.port, username: p.username, password: dec(p.password) })

// ---------- testing ----------
const testSockets = new Set<net.Socket>()
let cancelFlag = false, testing = false
function applyProbe(p: P, r: Awaited<ReturnType<typeof probe>>) {
  p.lastTest = Date.now(); p.updatedAt = p.lastTest; p.stages = r.stg
  if (r.ok) { p.latency = r.latency; p.lastOk = p.lastTest; p.status = S.statusFromLatency(r.latency); p.successes++; p.reason = undefined }
  else { p.latency = undefined; p.failures++; p.status = S.statusFromCode(r.code); p.reason = r.code }
}
const testable = (p: P) => S.browserCapable(p)
async function bulkTest(ids: string[]) {
  if (testing) return
  testing = true; cancelFlag = false
  const q = ids.map((i) => proxies.get(i)).filter((p): p is P => !!p && testable(p))
  const pr = (progress = { total: q.length, done: 0, working: 0, failed: 0, testing: 0 })
  let i = 0
  const worker = async () => {
    while (!cancelFlag && i < q.length) {
      const p = q[i++], prev = p.status
      p.status = 'testing'; pr.testing++; notify()
      const r = await probe(tgt(p), testSockets)
      pr.testing--
      if (cancelFlag && !r.ok) { p.status = prev; continue }
      applyProbe(p, r); pr.done++; r.ok ? pr.working++ : pr.failed++; notify()
    }
  }
  await Promise.all(Array.from({ length: Math.min(48, q.length) }, worker))
  for (const p of q) if (p.status === 'testing') p.status = 'unknown'
  testing = false; progress = null; saveSoon(); notify()
}
const cancelTests = () => { cancelFlag = true; for (const s of testSockets) s.destroy() }

// ---------- routing: adapter + bridge ----------
let bridge: net.Server | null = null
const closeBridge = () => { bridge?.close(); bridge = null }
function startBridge(p: P): Promise<number> {
  closeBridge()
  const target = tgt(p)
  return new Promise((resolve) => {
    bridge = net.createServer(async (c) => {
      c.on('error', () => {})
      try {
        const g = await rd(c, 2); await rd(c, g[1]); c.write(Buffer.from([5, 0]))
        const q = await rd(c, 4); let host: string
        if (q[3] === 1) host = [...(await rd(c, 4))].join('.')
        else if (q[3] === 3) host = (await rd(c, (await rd(c, 1))[0])).toString()
        else { const b = await rd(c, 16); host = Array.from({ length: 8 }, (_, i) => b.readUInt16BE(i * 2).toString(16)).join(':') }
        const port = (await rd(c, 2)).readUInt16BE(0)
        const u = await openTunnel(target, host, port)
        reportOk()
        c.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]))
        u.on('error', () => c.destroy()); c.on('close', () => u.destroy()); c.pipe(u); u.pipe(c)
      } catch { onProxyFailure(); c.write(Buffer.from([5, 4, 0, 1, 0, 0, 0, 0, 0, 0]), () => c.destroy()) }
    })
    bridge.listen(0, '127.0.0.1', () => resolve((bridge!.address() as net.AddressInfo).port))
  })
}
/** Proxy adapter: how Chromium reaches this proxy. Native where Chromium supports it, loopback bridge otherwise (credentials, SOCKS4a). */
async function applyRoute(p: P | null) {
  let expect: string | null = null, via = 'direct'
  if (!p) { closeBridge(); await ses.setProxy({ mode: 'direct' }) }
  else if (p.username !== undefined || p.protocol === 'socks4a') {
    const port = await startBridge(p); via = 'bridge'; expect = `127.0.0.1:${port}`
    await ses.setProxy({ mode: 'fixed_servers', proxyRules: `socks5://${expect}` })
  } else {
    closeBridge(); via = 'native'; expect = `${p.host}:${p.port}`
    await ses.setProxy({ mode: 'fixed_servers', proxyRules: `${p.protocol}://${expect}` })
  }
  await ses.closeAllConnections(); await ses.forceReloadProxyConfig()
  return { expect, via }
}
/** Verifies the route through Chromium's own network stack: resolved proxy + a real request via the session. */
async function verify(expect: string | null) {
  const t0 = Date.now()
  try {
    const rp = await ses.resolveProxy('https://www.gstatic.com/generate_204')
    if (expect ? !rp.includes(expect) : !/DIRECT/i.test(rp)) return { ok: false, ms: 0 }
    const res = await ses.fetch('https://www.gstatic.com/generate_204', { signal: AbortSignal.timeout(10000) })
    return { ok: res.status === 204 || res.status === 200, ms: Date.now() - t0 }
  } catch { return { ok: false, ms: 0 } }
}
let chain: Promise<unknown> = Promise.resolve()
export const useProxy = (id: string | null): Promise<{ ok: boolean; error?: string }> => { const r = chain.then(() => doUse(id)); chain = r.catch(() => {}); return r }
async function doUse(id: string | null): Promise<{ ok: boolean; error?: string }> {
  const prev = active
  fails = 0
  if (id === null) { await applyRoute(null); active = null; db.activeId = null; route = { ok: true, at: Date.now(), via: 'direct' }; saveSoon(); notify(); return { ok: true } }
  const p = proxies.get(id)
  if (!p) return { ok: false, error: 'Proxy not found' }
  if (!S.browserCapable(p)) return { ok: false, error: 'MTProto is Telegram-only' }
  const a = await applyRoute(p), v = await verify(a.expect)
  p.lastTest = Date.now()
  if (!v.ok) {
    p.failures++; p.status = 'failed'; p.reason = 'ROUTE_FAILED'; await applyRoute(prev)
    notify(); return { ok: false, error: 'Browser route verification failed' }
  }
  active = p; db.activeId = p.id; p.uses++; p.successes++; p.latency = v.ms; p.lastOk = p.lastTest; p.status = S.statusFromLatency(v.ms); p.reason = undefined
  route = { ok: true, ms: v.ms, at: Date.now(), via: a.via }
  saveSoon(); notify(); return { ok: true }
}

// ---------- failure monitoring / failover ----------
let fails = 0, switching = false, lastSwitchAt = 0
const switchTimes: number[] = []
export const reportOk = () => { fails = 0 }
export function onProxyFailure() {
  if (!active || switching) return
  fails++
  if (!db.failover) return
  if (S.shouldFailover({ fails, threshold: db.threshold, now: Date.now(), lastSwitchAt, cooldownMs: db.cooldownSec * 1000, switchTimes, maxPer5min: 4 })) void failoverNow()
}
async function failoverNow() {
  switching = true
  try {
    const cur = active
    if (cur) { cur.failures++; cur.status = 'failed'; cur.reason = 'BROWSER_FAILURES' }
    const top = S.rankSorted([...proxies.values()].filter((p) => p.id !== cur?.id)).slice(0, 8)
    await Promise.all(top.map(async (p) => applyProbe(p, await probe(tgt(p), testSockets))))
    for (const p of S.rankSorted(top)) if ((await useProxy(p.id)).ok) { say(`Switched to ${p.protocol.toUpperCase()} ${p.host}:${p.port}`); return }
    if (db.fallbackDirect) { await useProxy(null); say('No working proxy; using Direct') } else say('No working proxy available')
  } finally { lastSwitchAt = Date.now(); switchTimes.push(lastSwitchAt); fails = 0; switching = false; saveSoon(); notify() }
}
async function autoSelect() {
  if (!S.pickBest([...proxies.values()])) await bulkTest([...proxies.values()].filter((p) => p.status === 'unknown').slice(0, 150).map((p) => p.id))
  for (const p of S.rankSorted([...proxies.values()]).slice(0, 5)) { const r = await useProxy(p.id); if (r.ok) return { ok: true, name: `${p.protocol.toUpperCase()} ${p.host}:${p.port}`, latency: p.latency } }
  return { ok: false, error: 'No working proxy found' }
}
export async function startup() {
  const p = db.activeId ? proxies.get(db.activeId) : undefined
  db.activeId = null
  if (!p) return
  if (!(await useProxy(p.id)).ok && db.failover) await failoverNow()
}
export async function clearData() { await ses.clearStorageData(); await ses.clearCache() }
export function initEngine(s: Session, w: () => BrowserWindow | undefined) { ses = s; getWin = w }

// ---------- IPC ----------
let pending: { token: string; recs: S.Rec[]; source: S.Source; meta?: string } | null = null
const tick = () => new Promise((r) => setImmediate(r))
const SOURCES = ['Clipboard', 'TXT', 'JSON', 'Manual', 'Telegram']
const INFER = ['off', ...S.PROTOCOLS]
function plain(p: P): S.Rec { return { protocol: p.protocol, host: p.host, port: p.port, username: p.username, password: dec(p.password), secret: dec(p.secret) } }

export function registerProxyIpc(h: (ch: string, fn: (...a: any[]) => unknown) => void) {
  h('state:get', () => publicState())
  h('clipboard:read', () => clipboard.readText().slice(0, 50_000_000))
  h('proxy:preview', async (o: any) => {
    if (typeof o?.text !== 'string' || o.text.length > 60_000_000) throw new Error('bad')
    const infer = (INFER.includes(o.infer) ? o.infer : 'off') as S.Infer
    const source = (SOURCES.includes(o.source) ? o.source : 'Manual') as S.Source
    const j = S.tryJson(o.text)
    let results: S.Res[] = []
    if (j !== undefined) results = S.fromJson(j, infer)
    else { const lines = S.splitLines(o.text); for (let i = 0; i < lines.length; i += 2000) { for (const r of S.parseLines(lines.slice(i, i + 2000), infer)) results.push(r); await tick() } }
    const sm = S.summarize(results, new Set([...proxies.values()].map((p) => S.keyOf(p))))
    const { newRecs, ...rest } = sm
    pending = { token: randomUUID(), recs: newRecs, source, meta: typeof o.meta === 'string' ? o.meta.slice(0, 120) : undefined }
    return { ok: true, token: pending.token, ...rest }
  })
  h('proxy:commit', async (o: any) => {
    if (!pending || pending.token !== o?.token) return { ok: false, error: 'Preview expired' }
    const { recs, source, meta } = pending; pending = null
    const ids: string[] = []
    for (let i = 0; i < recs.length; i++) {
      const r = recs[i], id = S.idOf(r), now = Date.now()
      proxies.set(id, { id, protocol: r.protocol, host: r.host, port: r.port, username: r.username, password: enc(r.password), secret: enc(r.secret), source: r.protocol === 'mtproto' && source !== 'JSON' && source !== 'TXT' ? 'Telegram' : source, meta,
        createdAt: now, updatedAt: now, status: r.protocol === 'mtproto' ? 'unsupported' : 'unknown', failures: 0, successes: 0, uses: 0 })
      ids.push(id); if (i % 2000 === 1999) await tick()
    }
    saveSoon(); notify()
    if (o.test) void bulkTest(ids)
    return { ok: true, added: ids.length }
  })
  h('proxy:list', (o: any) => {
    const f = String(o?.filter ?? 'all'), q = String(o?.search ?? '').toLowerCase().slice(0, 100)
    const all = [...proxies.values()]
    const counts: Record<string, number> = {}
    for (const k of S.FILTERS) counts[k] = k === 'all' ? all.length : 0
    for (const p of all) for (const k of S.FILTERS) if (k !== 'all' && S.matchFilter(p, k)) counts[k]++
    let l = all.filter((p) => S.matchFilter(p, f) && (!q || `${p.protocol} ${p.host}:${p.port} ${p.source}`.toLowerCase().includes(q)))
    l = S.sortList(l, String(o?.sort ?? 'status'), o?.desc === true)
    const off = Math.max(0, Number(o?.offset) | 0), lim = Math.min(200, Math.max(1, Number(o?.limit) | 0 || 50))
    return { ok: true, total: l.length, counts, items: l.slice(off, off + lim).map((p) => S.toPublic(p, db.activeId)) }
  })
  h('proxy:best', () => ({ ok: true, items: S.rankSorted([...proxies.values()]).slice(0, 5).map((p) => S.toPublic(p, db.activeId)) }))
  h('proxy:test', (o: any) => {
    const all = [...proxies.values()]
    const ids = o?.scope === 'all' ? all.map((p) => p.id) : o?.scope === 'unhealthy' ? all.filter((p) => ['failed', 'timeout'].includes(p.status) || p.status === 'unknown').map((p) => p.id) : Array.isArray(o?.ids) ? o.ids.filter((x: unknown) => typeof x === 'string').slice(0, 100000) : []
    void bulkTest(ids); return { ok: true }
  })
  h('proxy:cancel', () => { cancelTests(); return { ok: true } })
  h('proxy:delete', async (o: any) => {
    const ids: string[] = Array.isArray(o?.ids) ? o.ids.filter((x: unknown) => typeof x === 'string') : []
    if (db.activeId && ids.includes(db.activeId)) await useProxy(null)
    for (const i of ids) proxies.delete(i)
    saveSoon(); notify(); return { ok: true }
  })
  h('proxy:use', (o: any) => useProxy(o?.id === null ? null : String(o?.id)))
  h('proxy:auto', () => autoSelect())
  h('settings:set', (s: any) => {
    db.failover = s?.failover === true; db.fallbackDirect = s?.fallbackDirect === true
    db.threshold = Math.min(10, Math.max(1, Math.floor(Number(s?.threshold)) || 3)); db.cooldownSec = Math.min(600, Math.max(5, Math.floor(Number(s?.cooldownSec)) || 30))
    saveSoon(); notify(); return { ok: true }
  })
  h('proxy:copy', (o: any) => {
    const p = proxies.get(String(o?.id)); if (!p) return { ok: false, error: 'Not found' }
    const uri = o.format === 'tg' ? S.toTelegramSocks(plain(p), o.creds === true) : S.toUri(plain(p), { creds: o.creds === true })
    if (!uri) return { ok: false, error: 'Only SOCKS5 proxies can be converted to Telegram SOCKS format.' }
    clipboard.writeText(uri); return { ok: true }
  })
  h('proxy:export', async (o: any) => {
    const fmt = ['txt', 'json', 'csv'].includes(o?.format) ? o.format : 'txt', scope = String(o?.scope ?? 'all')
    const sel = new Set<string>(Array.isArray(o?.ids) ? o.ids : [])
    const list = [...proxies.values()].filter((p) => scope === 'usable' || scope === 'working' ? S.isUsable(p) : scope === 'socks5' ? p.protocol === 'socks5' : scope === 'selected' ? sel.has(p.id) : true)
    const creds = o?.creds === true, telegram = o?.telegram === true
    const rows = list.map((p) => { const r = plain(p); return { protocol: p.protocol, host: p.host, port: p.port, status: p.status, latency: p.latency ?? null, uri: S.toUri(r, { creds, telegram }), ...(creds ? { username: r.username, password: r.password } : {}) } })
    const csv = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const text = fmt === 'json' ? JSON.stringify(rows, null, 2) : fmt === 'csv' ? ['protocol,host,port,status,latency,uri', ...rows.map((r) => [r.protocol, r.host, r.port, r.status, r.latency, r.uri].map(csv).join(','))].join('\n') : rows.map((r) => r.uri).join('\n')
    const win = getWin(); if (!win) return { ok: false }
    const r = await dialog.showSaveDialog(win, { defaultPath: `telefox-proxies.${fmt}` })
    if (r.canceled || !r.filePath) return { ok: false, error: 'Cancelled' }
    fs.writeFileSync(r.filePath, text); return { ok: true, count: rows.length }
  })
}
