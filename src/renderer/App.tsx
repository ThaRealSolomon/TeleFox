import { useCallback, useEffect, useRef, useState } from 'react'
import { isProxyUri, parseProxy, PublicProxy } from '../shared/proxy'

const tf = (window as any).tf as { invoke: (c: string, ...a: any[]) => Promise<any>; on: (c: string, f: (d: any) => void) => void }
interface Tab { id: number; title: string; url: string; loading: boolean }
interface St { version: number; activeId: string | null; active: { protocol: string; host: string; port: number; latency?: number } | null; route: { ok: boolean; ms?: number; via: string; at: number } | null; progress: { total: number; done: number; working: number; failed: number; testing: number } | null; notice: { id: number; text: string }; settings: { failover: boolean; threshold: number; cooldownSec: number; fallbackDirect: boolean } }
const ST: Record<string, string> = { unknown: '○ Unknown', testing: '◐ Testing', healthy: '● Healthy', slow: '◑ Slow', failed: '✕ Failed', timeout: '✕ Timeout', auth_required: '⚿ Authentication Required', auth_failed: '✕ Authentication Failed', unsupported: '– Unsupported', disconnected: '○ Disconnected' }
const PL = (p: { protocol: string }) => (p.protocol === 'mtproto' ? 'MTProto' : p.protocol.toUpperCase())
const ROW = 58
const fmt = (t?: number) => (t ? new Date(t).toLocaleString() : '—')

export default function App() {
  const [tabs, setTabs] = useState<{ active: number; list: Tab[] }>({ active: 0, list: [] })
  const [st, setSt] = useState<St>({ version: 0, activeId: null, active: null, route: null, progress: null, notice: { id: 0, text: '' }, settings: { failover: true, threshold: 3, cooldownSec: 30, fallbackDirect: false } })
  const [view, setView] = useState<'none' | 'switch' | 'manage'>('none')
  const [imp, setImp] = useState<{ text: string; source: string } | null>(null)
  const [addr, setAddr] = useState('')
  const [toast, setToast] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const say = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(''), 3500) }, [])

  useEffect(() => {
    tf.on('tabs', setTabs); tf.on('state', setSt); tf.on('import-link', (l: string) => setImp({ text: l, source: 'Telegram' }))
    tf.on('focus-addr', () => { input.current?.focus(); input.current?.select() })
    tf.invoke('state:get').then(setSt); tf.invoke('init')
  }, [])
  useEffect(() => { tf.invoke('overlay', view !== 'none' || imp !== null) }, [view, imp])
  useEffect(() => { if (st.notice.text) say(st.notice.text) }, [st.notice.id])
  const cur = tabs.list.find((t) => t.id === tabs.active)
  useEffect(() => { setAddr(cur?.url ?? '') }, [cur?.url, tabs.active])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (isProxyUri(addr)) { if (parseProxy(addr).ok) setImp({ text: addr.trim(), source: 'Telegram' }); else say('Unsupported or invalid proxy link'); return }
    tf.invoke('tab:nav', addr)
  }
  const chip = st.active ? `${PL(st.active)} · ${st.active.latency ?? '—'} ms` : 'Direct'

  return (
    <div className="app">
      <div className="tabbar">
        {tabs.list.map((t) => (
          <div key={t.id} className={'tab' + (t.id === tabs.active ? ' on' : '')} onClick={() => tf.invoke('tab:switch', t.id)} title={t.title}>
            {t.loading && <span className="spin" />}<span className="tt">{t.title}</span>
            <button className="x" aria-label="Close tab" onClick={(e) => { e.stopPropagation(); tf.invoke('tab:close', t.id) }}>×</button>
          </div>
        ))}
        <button className="ib" aria-label="New tab" onClick={() => tf.invoke('tab:new')}>+</button>
      </div>
      <form className="toolbar" onSubmit={submit}>
        <button type="button" className="ib" aria-label="Back" onClick={() => tf.invoke('tab:back')}>←</button>
        <button type="button" className="ib" aria-label="Forward" onClick={() => tf.invoke('tab:forward')}>→</button>
        <button type="button" className="ib" aria-label="Reload or stop" onClick={() => tf.invoke('tab:reload')}>{cur?.loading ? '■' : '⟳'}</button>
        <input ref={input} className="addr" value={addr} onChange={(e) => setAddr(e.target.value)} onFocus={(e) => e.target.select()} placeholder="Search or enter address" spellCheck={false} />
        <button type="button" className={'pill' + (st.activeId ? ' on' : '')} onClick={() => setView('switch')}>{chip}</button>
      </form>
      {view === 'switch' && <Switcher st={st} onClose={() => setView('none')} onManage={() => setView('manage')} say={say} />}
      {view === 'manage' && <Manager st={st} onClose={() => setView('none')} onImport={(t, s) => setImp({ text: t, source: s })} say={say} />}
      {imp && <ImportDialog init={imp} onClose={() => setImp(null)} say={say} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}

function Switcher({ st, onClose, onManage, say }: { st: St; onClose: () => void; onManage: () => void; say: (m: string) => void }) {
  const [best, setBest] = useState<PublicProxy[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => { tf.invoke('proxy:best').then((r: any) => setBest(r.items ?? [])) }, [st.version])
  const use = async (id: string | null) => { setBusy(true); const r = await tf.invoke('proxy:use', { id }); setBusy(false); if (!r.ok) say(r.error || 'Failed'); else onClose() }
  const cur = best.find((p) => p.active)
  return (
    <div className="scrim top" onClick={onClose}>
      <div className="switcher" onClick={(e) => e.stopPropagation()}>
        <button className={'srow' + (!st.activeId ? ' on' : '')} disabled={busy} onClick={() => use(null)}>Direct{!st.activeId && ' ✓'}</button>
        {st.route && <div className="muted pad">Route: {st.route.ok ? 'verified' : 'failed'} · {st.route.via}{st.route.ms ? ` · ${st.route.ms} ms` : ''}</div>}
        <div className="muted pad">{cur ? 'Current' : 'Best'}</div>
        {best.length === 0 && <div className="muted pad">No verified proxies. Open the manager to import and test.</div>}
        {best.map((p) => <button key={p.id} className={'srow' + (p.active ? ' on' : '')} disabled={busy} onClick={() => use(p.id)}>{p.active ? '✓ ' : ''}{PL(p)} {p.host}:{p.port}<span>{p.latency} ms</span></button>)}
        <button className="srow" onClick={onManage}>Proxy Manager</button>
      </div>
    </div>
  )
}

function ImportDialog({ init, onClose, say }: { init: { text: string; source: string }; onClose: () => void; say: (m: string) => void }) {
  const [text, setText] = useState(init.text)
  const [infer, setInfer] = useState('off')
  const [pv, setPv] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [test, setTest] = useState(true)
  const run = async () => { setBusy(true); const r = await tf.invoke('proxy:preview', { text, infer, source: init.source }); setBusy(false); setPv(r) }
  useEffect(() => { if (init.text) run() }, [])
  const commit = async () => { const r = await tf.invoke('proxy:commit', { token: pv.token, test }); if (r.ok) { say(`Imported ${r.added}`); onClose() } else say(r.error || 'Import failed') }
  const n = (v?: number) => (v ?? 0).toLocaleString()
  return (
    <div className="scrim" onClick={onClose}>
      <div className="dialog wide" onClick={(e) => e.stopPropagation()}>
        <h2>Import Proxies</h2>
        {!pv ? <>
          <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={'socks5://…\nhttp://user:pass@…\ntg://socks?server=…&port=…'} spellCheck={false} />
          <div className="row"><label className="muted">Raw host:port as <select value={infer} onChange={(e) => setInfer(e.target.value)}>{['off', 'socks5', 'socks4', 'http', 'https'].map((x) => <option key={x}>{x}</option>)}</select></label>
            <span style={{ flex: 1 }} /><button onClick={onClose}>Cancel</button><button className="primary" disabled={!text.trim() || busy} onClick={run}>{busy ? 'Parsing…' : 'Preview'}</button></div>
        </> : <>
          <table className="sum"><tbody>
            <tr><td>Total records</td><td>{n(pv.total)}</td></tr><tr><td>Valid</td><td>{n(pv.valid)}</td></tr><tr><td>Invalid</td><td>{n(pv.invalid)}</td></tr><tr><td>Duplicates</td><td>{n(pv.duplicates)}</td></tr>
            {['socks5', 'socks4', 'socks4a', 'http', 'https', 'mtproto'].map((k) => <tr key={k} className="sub"><td>{k === 'mtproto' ? 'MTProto (Telegram-only)' : k.toUpperCase()}</td><td>{n(pv.byProtocol?.[k])}</td></tr>)}
          </tbody></table>
          {pv.errors?.length > 0 && <p className="muted">Invalid examples: {pv.errors.join('; ')}</p>}
          <div className="row"><label><input type="checkbox" checked={test} onChange={(e) => setTest(e.target.checked)} /> Test after import</label><span style={{ flex: 1 }} />
            <button onClick={() => setPv(null)}>Back</button><button onClick={onClose}>Cancel</button><button className="primary" disabled={!pv.valid && !pv.byProtocol} onClick={commit}>Import</button></div>
        </>}
      </div>
    </div>
  )
}

function Manager({ st, onClose, onImport, say }: { st: St; onClose: () => void; onImport: (t: string, s: string) => void; say: (m: string) => void }) {
  const [filter, setFilter] = useState('all'), [sort, setSort] = useState('status'), [search, setSearch] = useState('')
  const [data, setData] = useState<{ total: number; counts: Record<string, number>; items: PublicProxy[] }>({ total: 0, counts: {}, items: [] })
  const [top, setTop] = useState(0), [h, setH] = useState(400)
  const [sel, setSel] = useState<Set<string>>(new Set()), [focus, setFocus] = useState<PublicProxy | null>(null)
  const [drag, setDrag] = useState(false)
  const [ex, setEx] = useState({ format: 'txt', scope: 'working', telegram: false, creds: false })
  const box = useRef<HTMLDivElement>(null)
  const offset = Math.max(0, Math.floor(top / ROW) - 4), limit = Math.ceil(h / ROW) + 10
  useEffect(() => { let off = false; tf.invoke('proxy:list', { filter, sort, search, offset, limit }).then((r: any) => { if (!off && r.ok) { setData(r); setFocus((f) => (f ? r.items.find((i: PublicProxy) => i.id === f.id) ?? f : f)) } }); return () => { off = true } }, [filter, sort, search, offset, limit, st.version])
  useEffect(() => { const el = box.current; if (!el) return; const ro = new ResizeObserver(() => setH(el.clientHeight)); ro.observe(el); setH(el.clientHeight); return () => ro.disconnect() }, [])
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const drop = async (e: React.DragEvent) => {
    e.preventDefault(); setDrag(false)
    const f = e.dataTransfer.files[0]; if (!f) return
    if (!/\.(txt|json)$/i.test(f.name)) { say('Only TXT and JSON files are supported'); return }
    onImport(await f.text(), /\.json$/i.test(f.name) ? 'JSON' : 'TXT')
  }
  const pr = st.progress, s = st.settings
  const act = async (c: string, a?: any) => { const r = await tf.invoke(c, a); if (r && r.ok === false && r.error) say(r.error); return r }
  return (
    <div className="scrim" onClick={onClose}>
      <div className="panel big" onClick={(e) => e.stopPropagation()} onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)} onDrop={drop}>
        {drag && <div className="drop">Drop TXT or JSON to import</div>}
        <header><h2>Proxies <span className="muted">{(data.counts.all ?? 0).toLocaleString()}</span></h2>
          <div className="row">
            <button onClick={() => onImport('', 'Manual')}>Import</button>
            <button onClick={async () => { const t = await tf.invoke('clipboard:read'); if (typeof t === 'string' && t.trim()) onImport(t, 'Clipboard'); else say('Clipboard is empty') }}>Clipboard</button>
            <button onClick={() => act('proxy:test', { scope: 'all' })}>Test all</button>
            <button onClick={() => act('proxy:test', { scope: 'unhealthy' })}>Test unhealthy</button>
            <button disabled={!sel.size} onClick={() => act('proxy:test', { ids: [...sel] })}>Test selected</button>
            <button onClick={async () => { say('Selecting best…'); const r = await act('proxy:auto'); if (r.ok) say(`Selected ${r.name} · ${r.latency} ms`) }}>Auto select best</button>
            <button onClick={onClose} aria-label="Close">×</button></div></header>
        <div className="bar row">
          <select value={filter} onChange={(e) => { setFilter(e.target.value); setTop(0); box.current?.scrollTo(0, 0) }}>
            {['all', 'working', 'fast', 'reliable', 'failed', 'testing', 'untested', 'socks5', 'socks4', 'http', 'https', 'mtproto', 'auth', 'noauth', 'unsupported'].map((f) => <option key={f} value={f}>{f} ({(data.counts[f] ?? 0).toLocaleString()})</option>)}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value)}>{['status', 'latency', 'protocol', 'reliability', 'lastTested', 'lastOk', 'usage'].map((f) => <option key={f}>{f}</option>)}</select>
          <input placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button disabled={!sel.size} onClick={async () => { await act('proxy:delete', { ids: [...sel] }); setSel(new Set()); setFocus(null) }}>Delete {sel.size || ''}</button>
        </div>
        {pr && <div className="prog"><div style={{ width: `${(pr.done / Math.max(1, pr.total)) * 100}%` }} /><span>Testing proxies · {pr.done.toLocaleString()} / {pr.total.toLocaleString()} · Working {pr.working.toLocaleString()} · Failed {pr.failed.toLocaleString()} · Testing {pr.testing}</span><button onClick={() => act('proxy:cancel')}>Cancel</button></div>}
        <div className="vlist" ref={box} onScroll={(e) => setTop(e.currentTarget.scrollTop)}>
          <div style={{ height: data.total * ROW, position: 'relative' }}>
            {data.total === 0 && <p className="muted pad">No proxies match. Import a list, or drop a TXT / JSON file here.</p>}
            {data.items.map((p, i) => (
              <div key={p.id} className={'vrow' + (focus?.id === p.id ? ' on' : '') + (p.active ? ' act' : '')} style={{ top: (offset + i) * ROW, height: ROW }} onClick={() => setFocus(p)}>
                <input type="checkbox" checked={sel.has(p.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(p.id)} aria-label="Select" />
                <div className="meta"><b>{PL(p)} <span className="mono">{p.host}:{p.port}</span></b><span className="muted">Auth: {p.hasSecret ? 'Secret' : p.hasCreds ? 'Credentials' : 'None'} · Source: {p.source}{p.protocol === 'mtproto' ? ' · Telegram-only' : ''}</span></div>
                <div className="stat">{p.latency ? `${p.latency} ms` : '—'}<br /><span className="muted">{ST[p.status]}</span></div>
              </div>))}
          </div>
        </div>
        {focus && <Details p={focus} act={act} say={say} />}
        <footer className="row wrap">
          <label><input type="checkbox" checked={s.failover} onChange={(e) => act('settings:set', { ...s, failover: e.target.checked })} /> Auto failover</label>
          <label>Threshold <input type="number" min={1} max={10} value={s.threshold} onChange={(e) => act('settings:set', { ...s, threshold: Number(e.target.value) })} /></label>
          <label>Cooldown s <input type="number" min={5} max={600} value={s.cooldownSec} onChange={(e) => act('settings:set', { ...s, cooldownSec: Number(e.target.value) })} /></label>
          <label><input type="checkbox" checked={s.fallbackDirect} onChange={(e) => act('settings:set', { ...s, fallbackDirect: e.target.checked })} /> Fallback to Direct</label>
          <span style={{ flex: 1 }} />
          <select value={ex.format} onChange={(e) => setEx({ ...ex, format: e.target.value })}><option>txt</option><option>json</option><option>csv</option></select>
          <select value={ex.scope} onChange={(e) => setEx({ ...ex, scope: e.target.value })}><option value="all">all</option><option value="usable">usable only</option><option value="working">working only</option><option value="socks5">SOCKS5 only</option><option value="selected">selected</option></select>
          <label><input type="checkbox" checked={ex.telegram} onChange={(e) => setEx({ ...ex, telegram: e.target.checked })} /> tg://socks</label>
          <label title="Writes passwords in plain text to the exported file"><input type="checkbox" checked={ex.creds} onChange={(e) => setEx({ ...ex, creds: e.target.checked })} /> Include credentials</label>
          <button onClick={async () => { const r = await act('proxy:export', { ...ex, ids: [...sel] }); if (r.ok) say(`Exported ${r.count}`) }}>Export</button>
        </footer>
      </div>
    </div>
  )
}

function Details({ p, act, say }: { p: PublicProxy; act: (c: string, a?: any) => Promise<any>; say: (m: string) => void }) {
  const [creds, setCreds] = useState(false)
  const yn = (b: boolean) => (b ? '✓' : '✕')
  const stg = p.stages
  return (
    <div className="detail">
      <div className="grid">
        <span>Protocol</span><b>{PL(p)}</b><span>Host</span><b className="mono">{p.host}</b><span>Port</span><b>{p.port}</b>
        <span>Authentication</span><b>{p.hasSecret ? 'MTProto secret ••••' : p.hasCreds ? 'Credentials ••••••' : 'None'}</b>
        <span>Browser</span><b>{p.browserCapable ? `${yn(true)} Usable` : `${yn(false)} Generic browsing unsupported`}</b>
        <span>Telegram SOCKS</span><b>{p.telegramSocks ? `${yn(true)} Convertible` : p.protocol === 'mtproto' ? '✓ Telegram-only (kept as MTProto)' : `${yn(false)} Not convertible`}</b>
        <span>Status</span><b>{ST[p.status]}{p.reason ? ` (${p.reason})` : ''}</b><span>Latency</span><b>{p.latency ? `${p.latency} ms` : '—'}</b>
        <span>Last tested</span><b>{fmt(p.lastTest)}</b><span>Last successful</span><b>{fmt(p.lastOk)}</b>
        <span>Success / Failure / Usage</span><b>{p.successes} / {p.failures} / {p.uses}</b><span>Source</span><b>{p.source}{p.meta ? ` · ${p.meta}` : ''}</b>
        {stg && <><span>Last test</span><b>Connection {yn(!!stg.connection)} · Handshake {yn(!!stg.handshake)} · Auth {yn(!!stg.auth)} · HTTPS {yn(!!stg.https)}</b></>}
      </div>
      {!p.telegramSocks && p.protocol !== 'mtproto' && <p className="muted">Only SOCKS5 proxies can be converted to Telegram SOCKS format.</p>}
      <div className="row wrap">
        {p.browserCapable && (p.active ? <button onClick={() => act('proxy:use', { id: null })}>Disconnect</button> : <button className="primary" onClick={async () => { const r = await act('proxy:use', { id: p.id }); if (r.ok) say('Route verified') }}>Use</button>)}
        {p.browserCapable && <button onClick={() => act('proxy:test', { ids: [p.id] })}>Test</button>}
        <button onClick={async () => { const r = await act('proxy:copy', { id: p.id, format: 'uri', creds }); if (r.ok) say('Copied') }}>Copy URI</button>
        {p.telegramSocks && <button onClick={async () => { const r = await act('proxy:copy', { id: p.id, format: 'tg', creds }); if (r.ok) say('Copied tg://socks') }}>Copy tg://socks</button>}
        {(p.hasCreds || p.hasSecret) && <label className="muted"><input type="checkbox" checked={creds} onChange={(e) => setCreds(e.target.checked)} /> with credentials</label>}
        <button onClick={() => act('proxy:delete', { ids: [p.id] })}>Delete</button>
      </div>
    </div>
  )
}
