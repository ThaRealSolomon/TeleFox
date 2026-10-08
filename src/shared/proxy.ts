export const PROTOCOLS = ['socks5', 'socks4', 'socks4a', 'http', 'https', 'mtproto'] as const
export type Protocol = (typeof PROTOCOLS)[number]
export type Infer = Protocol | 'off'
export type Status = 'unknown' | 'testing' | 'healthy' | 'slow' | 'failed' | 'timeout' | 'auth_required' | 'auth_failed' | 'unsupported' | 'disconnected'
export type Source = 'Clipboard' | 'TXT' | 'JSON' | 'Manual' | 'Telegram'
export interface Rec { protocol: Protocol; host: string; port: number; username?: string; password?: string; secret?: string }
export interface Stages { connection?: boolean; handshake?: boolean; auth?: boolean; https?: boolean }
export interface ProxyEntry extends Rec { id: string; source: Source; meta?: string; createdAt: number; updatedAt: number; status: Status; reason?: string; stages?: Stages; latency?: number; lastTest?: number; lastOk?: number; failures: number; successes: number; uses: number }
export type Res = { ok: true; rec: Rec } | { ok: false; error: string }

const SCHEMES: Record<string, Protocol> = { socks5: 'socks5', socks5h: 'socks5', socks: 'socks5', socks4: 'socks4', socks4a: 'socks4a', http: 'http', https: 'https' }
const DNS = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i
const dd = (s: string) => { try { return decodeURIComponent(s) } catch { return null } }

function validHost(h: string) {
  if (h.startsWith('[')) return /^\[[0-9a-f:.]+\]$/i.test(h) && h.includes(':')
  if (/^[\d.]+$/.test(h)) { const o = h.split('.'); return o.length === 4 && o.every((x) => /^\d{1,3}$/.test(x) && +x <= 255) }
  return DNS.test(h)
}
export function mkRec(protocol: Protocol, host: string, port: number, username?: string, password?: string, secret?: string): Res {
  host = host.trim()
  if (/^[0-9a-f:]+$/i.test(host) && host.includes(':')) host = `[${host}]`
  if (!validHost(host)) return { ok: false, error: 'Invalid host' }
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, error: 'Port must be 1-65535' }
  if (protocol === 'mtproto') return secret ? { ok: true, rec: { protocol, host, port, secret } } : { ok: false, error: 'MTProto link is missing a secret' }
  if (password && !username) return { ok: false, error: 'Password without username' }
  if ((username?.length ?? 0) > 255 || (password?.length ?? 0) > 255) return { ok: false, error: 'Credentials too long' }
  const rec: Rec = { protocol, host, port }
  if (username) rec.username = username
  if (password) rec.password = password
  return { ok: true, rec }
}
function parseTg(s: string): Res {
  let u: URL
  try { u = new URL(s) } catch { return { ok: false, error: 'Not a valid link' } }
  const type = u.protocol === 'tg:' ? u.hostname || u.pathname.replace(/^\/+/, '') : u.pathname.replace(/^\/+|\/+$/g, '')
  if (type !== 'socks' && type !== 'proxy') return { ok: false, error: 'Unsupported Telegram link type' }
  const q = u.searchParams
  const port = Number(q.get('port'))
  if (type === 'proxy') return mkRec('mtproto', q.get('server') || '', port, undefined, undefined, q.get('secret') || undefined)
  const user = q.get('user') || undefined, pass = q.get('pass') || undefined
  if (!!user !== !!pass) return { ok: false, error: 'Username and password must be given together' }
  return mkRec('socks5', q.get('server') || '', port, user, pass)
}
const normProto = (v: unknown): Protocol | null => (typeof v === 'string' ? (v.toLowerCase() === 'mtproto' ? 'mtproto' : SCHEMES[v.toLowerCase().replace(/:$/, '')] ?? null) : null)

export function parseProxy(raw: string, infer: Infer = 'off'): Res {
  const s = String(raw).replace(/^\uFEFF/, '').trim()
  if (!s) return { ok: false, error: 'Empty' }
  if (/^tg:/i.test(s) || /^https?:\/\/(t|telegram)\.me\/(socks|proxy)(\?|\/|$)/i.test(s)) return parseTg(s)
  const sch = /^([a-z][a-z0-9+.-]*):\/\//i.exec(s)
  if (sch && !SCHEMES[sch[1].toLowerCase()]) return { ok: false, error: 'Unsupported scheme' }
  const m = /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:([^:@/\s]*)(?::([^@/\s]*))?@)?(\[[0-9a-f:.]+\]|[^:/\s@[\]]+):(\d{1,5})\/?$/i.exec(s)
  if (!m) return { ok: false, error: 'Malformed proxy' }
  const protocol = sch ? SCHEMES[sch[1].toLowerCase()] : infer === 'off' ? null : infer
  if (!protocol) return { ok: false, error: 'Protocol required (raw host:port inference is off)' }
  if (protocol === 'mtproto') return { ok: false, error: 'MTProto needs a Telegram link' }
  const u = m[1] === undefined ? undefined : dd(m[1]), p = m[2] === undefined ? undefined : dd(m[2])
  if (u === null || p === null) return { ok: false, error: 'Bad percent-escape' }
  return mkRec(protocol, m[3], Number(m[4]), u || undefined, p || undefined)
}

export function fromJson(v: unknown, infer: Infer, out: Res[] = [], depth = 0): Res[] {
  if (depth > 6) return out
  if (Array.isArray(v)) { for (const x of v) fromJson(x, infer, out, depth + 1); return out }
  if (typeof v === 'string') { out.push(parseProxy(v, infer)); return out }
  if (!v || typeof v !== 'object') { out.push({ ok: false, error: 'Unrecognized record' }); return out }
  const o = v as Record<string, any>
  for (const k of ['proxy', 'url', 'uri', 'link']) if (typeof o[k] === 'string') { out.push(parseProxy(o[k], infer)); return out }
  const host = o.host ?? o.ip ?? o.hostname ?? o.server ?? o.address
  if (host === undefined) {
    let found = false
    for (const k of ['proxies', 'list', 'data', 'items', 'results', 'proxy_list']) if (o[k] !== undefined) { fromJson(o[k], infer, out, depth + 1); found = true }
    if (!found) out.push({ ok: false, error: 'Unrecognized record' })
    return out
  }
  const pr = [o.protocol, o.type, o.scheme, o.proto, Array.isArray(o.protocols) ? o.protocols[0] : o.protocols].find((x) => x !== undefined)
  const protocol = pr === undefined ? (infer === 'off' ? null : infer) : normProto(pr)
  if (!protocol) { out.push({ ok: false, error: pr === undefined ? 'Protocol required' : 'Unsupported protocol' }); return out }
  const str = (x: unknown) => (x === undefined || x === null || x === '' ? undefined : String(x))
  out.push(mkRec(protocol, String(host), Number(o.port), str(o.username ?? o.user), str(o.password ?? o.pass), str(o.secret)))
  return out
}
export function tryJson(text: string): unknown | undefined {
  const t = text.replace(/^\uFEFF/, '').trimStart()
  if (t[0] !== '[' && t[0] !== '{') return undefined
  try { return JSON.parse(t) } catch { return undefined }
}
export const splitLines = (text: string) => text.replace(/^\uFEFF/, '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
export const parseLines = (lines: string[], infer: Infer): Res[] => lines.map((l) => parseProxy(l, infer))
export function parseText(text: string, infer: Infer = 'off'): Res[] {
  const j = tryJson(text)
  return j !== undefined ? fromJson(j, infer) : parseLines(splitLines(text), infer)
}

export const keyOf = (r: Rec) => `${r.protocol}|${r.host.toLowerCase()}|${r.port}|${r.username ?? ''}|${r.secret ?? ''}`
export function idOf(r: Rec) { let a = 5381, b = 52711; for (const c of keyOf(r)) { a = (a * 33) ^ c.charCodeAt(0); b = (b * 31 + c.charCodeAt(0)) | 0 } return 'p' + (a >>> 0).toString(16) + (b >>> 0).toString(16) }
export function summarize(results: Res[], existing: Set<string>) {
  const seen = new Set(existing), byProtocol: Record<string, number> = {}, errors: string[] = [], newRecs: Rec[] = []
  let invalid = 0, duplicates = 0
  for (const r of results) {
    if (!r.ok) { invalid++; if (errors.length < 5) errors.push(r.error); continue }
    const k = keyOf(r.rec)
    if (seen.has(k)) { duplicates++; continue }
    seen.add(k); newRecs.push(r.rec); byProtocol[r.rec.protocol] = (byProtocol[r.rec.protocol] ?? 0) + 1
  }
  return { total: results.length, valid: newRecs.length + duplicates, invalid, duplicates, byProtocol, errors, newRecs }
}

// ---- capabilities, conversion ----
export const browserCapable = (p: Rec) => p.protocol !== 'mtproto'
export const telegramSocks = (p: Rec) => p.protocol === 'socks5'
export const telegramCompatible = (p: Rec) => p.protocol === 'socks5' || p.protocol === 'mtproto'
export const isUsable = (p: ProxyEntry) => browserCapable(p) && (p.status === 'healthy' || p.status === 'slow')
export const statusFromLatency = (ms: number): Status => (ms > 800 ? 'slow' : 'healthy')
export function statusFromCode(code: string): Status {
  return code === 'TIMEOUT' ? 'timeout' : code === 'AUTH_REQUIRED' ? 'auth_required' : code === 'AUTH_FAILED' ? 'auth_failed' : 'failed'
}
/** Format conversion: only SOCKS5 can become tg://socks. Returns null when impossible. */
export function toTelegramSocks(r: Rec, creds = false): string | null {
  if (r.protocol !== 'socks5') return null
  let s = `tg://socks?server=${encodeURIComponent(r.host.replace(/^\[|\]$/g, ''))}&port=${r.port}`
  if (creds && r.username) s += `&user=${encodeURIComponent(r.username)}&pass=${encodeURIComponent(r.password ?? '')}`
  return s
}
export function toUri(r: Rec, o: { creds?: boolean; telegram?: boolean } = {}): string {
  if (r.protocol === 'mtproto') return `tg://proxy?server=${encodeURIComponent(r.host.replace(/^\[|\]$/g, ''))}&port=${r.port}${o.creds && r.secret ? `&secret=${encodeURIComponent(r.secret)}` : ''}`
  if (o.telegram && r.protocol === 'socks5') return toTelegramSocks(r, o.creds)!
  const auth = o.creds && r.username ? `${encodeURIComponent(r.username)}${r.password ? ':' + encodeURIComponent(r.password) : ''}@` : ''
  return `${r.protocol}://${auth}${r.host}:${r.port}`
}

// ---- ranking / selection / failover ----
export function rank(p: ProxyEntry, now = Date.now()) {
  const rel = (p.successes + 1) / (p.successes + p.failures + 2)
  const lat = 1 / (1 + (p.latency ?? 5000) / 400)
  return rel * 0.6 + lat * 0.35 + (p.lastOk && now - p.lastOk < 600000 ? 0.05 : 0)
}
export const rankSorted = (list: ProxyEntry[], now = Date.now()) => list.filter(isUsable).sort((a, b) => rank(b, now) - rank(a, now))
export const pickBest = (list: ProxyEntry[], now = Date.now()) => rankSorted(list, now)[0] ?? null
export const nextFailover = (list: ProxyEntry[], currentId: string | null, now = Date.now()) => pickBest(list.filter((p) => p.id !== currentId), now)
export function shouldFailover(s: { fails: number; threshold: number; now: number; lastSwitchAt: number; cooldownMs: number; switchTimes: number[]; maxPer5min: number }) {
  return s.fails >= s.threshold && s.now - s.lastSwitchAt >= s.cooldownMs && s.switchTimes.filter((t) => s.now - t < 300000).length < s.maxPer5min
}
/** Chromium net errors that indicate a proxy problem (not a website problem). */
export const PROXY_ERRORS = new Set([-130, -111, -120, -121, -115, -127])
export const isProxyError = (code: number) => PROXY_ERRORS.has(code)

// ---- list filtering / sorting ----
export const FILTERS = ['all', 'working', 'fast', 'reliable', 'failed', 'testing', 'untested', 'socks5', 'socks4', 'http', 'https', 'mtproto', 'auth', 'noauth', 'unsupported'] as const
export function matchFilter(p: ProxyEntry, f: string): boolean {
  switch (f) {
    case 'working': return isUsable(p)
    case 'fast': return isUsable(p) && (p.latency ?? 1e9) < 200
    case 'reliable': return isUsable(p) && p.successes >= 2 && p.successes / (p.successes + p.failures) >= 0.9
    case 'failed': return ['failed', 'timeout', 'auth_required', 'auth_failed'].includes(p.status)
    case 'testing': return p.status === 'testing'
    case 'untested': return p.status === 'unknown'
    case 'socks5': return p.protocol === 'socks5'
    case 'socks4': return p.protocol === 'socks4' || p.protocol === 'socks4a'
    case 'http': case 'https': case 'mtproto': return p.protocol === f
    case 'auth': return p.username !== undefined
    case 'noauth': return p.username === undefined && p.protocol !== 'mtproto'
    case 'unsupported': return p.status === 'unsupported'
    default: return true
  }
}
const ORD: Record<Status, number> = { healthy: 0, slow: 1, testing: 2, unknown: 3, disconnected: 4, timeout: 5, auth_required: 6, auth_failed: 7, failed: 8, unsupported: 9 }
export function sortList(list: ProxyEntry[], key: string, desc = false) {
  const v: Record<string, (p: ProxyEntry) => number | string> = {
    latency: (p) => p.latency ?? 1e9, status: (p) => ORD[p.status], protocol: (p) => p.protocol, reliability: (p) => -rank(p),
    lastTested: (p) => -(p.lastTest ?? 0), lastOk: (p) => -(p.lastOk ?? 0), usage: (p) => -p.uses
  }
  const f = v[key] ?? v.latency, d = desc ? -1 : 1
  return list.sort((a, b) => { const x = f(a), y = f(b); return (x < y ? -1 : x > y ? 1 : 0) * d })
}
export function toPublic(p: ProxyEntry, activeId: string | null) {
  return { id: p.id, protocol: p.protocol, host: p.host, port: p.port, hasCreds: p.username !== undefined, hasSecret: !!p.secret, source: p.source, meta: p.meta, createdAt: p.createdAt,
    status: p.status, reason: p.reason, stages: p.stages, latency: p.latency, lastTest: p.lastTest, lastOk: p.lastOk, failures: p.failures, successes: p.successes, uses: p.uses,
    browserCapable: browserCapable(p), telegramSocks: telegramSocks(p), telegramCompatible: telegramCompatible(p), active: p.id === activeId, rank: Math.round(rank(p) * 100) }
}
export type PublicProxy = ReturnType<typeof toPublic>

export function normalizeInput(input: string, search = 'https://duckduckgo.com/?q='): string {
  const s = input.trim()
  if (!s) return 'about:blank'
  if (/^https?:\/\//i.test(s)) return s
  if (!/\s/.test(s) && /^(localhost|[\w-]+(\.[\w-]+)+)(:\d+)?(\/.*)?$/i.test(s)) return 'https://' + s
  return search + encodeURIComponent(s)
}
/** Address-bar detection: proxy URIs that must never be navigated to. http(s) is deliberately excluded (ambiguous with websites). */
export const isProxyUri = (s: string) => /^(socks[45]?[ah]?|socks5h?):\/\//i.test(s.trim()) || /^tg:\/\/(socks|proxy)/i.test(s.trim()) || /^https?:\/\/(t|telegram)\.me\/(socks|proxy)(\?|$)/i.test(s.trim())
