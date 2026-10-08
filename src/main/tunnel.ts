import net from 'node:net'
import tls from 'node:tls'
import dns from 'node:dns'
import type { Stages } from '../shared/proxy'

export class PErr extends Error { constructor(public code: string) { super(code) } }
export interface Target { protocol: string; host: string; port: number; username?: string; password?: string }

export function rd(s: net.Socket, n: number): Promise<Buffer> {
  return new Promise((res, rej) => {
    const clean = () => { s.off('readable', t); s.off('error', e); s.off('close', c) }
    const t = () => { const b = s.read(n); if (b) { clean(); res(b) } }
    const e = (er: Error) => { clean(); rej(er) }
    const c = () => e(new Error('closed'))
    s.on('readable', t); s.on('error', e); s.on('close', c); t()
  })
}
const norm = (e: any, stg: Stages) => e instanceof PErr ? e : new PErr(e?.code === 'ETIMEDOUT' ? 'TIMEOUT' : stg.connection ? 'HANDSHAKE' : /TLS|CERT|SSL/i.test(`${e?.code}${e?.message}`) ? 'TLS' : 'UNREACHABLE')

/** Opens a TCP tunnel to host:port through the given upstream proxy (all supported protocols). */
export async function openTunnel(p: Target, host: string, port: number, o: { stg?: Stages; ms?: number; track?: Set<net.Socket> } = {}): Promise<net.Socket> {
  const stg = o.stg ?? {}, bare = p.host.replace(/^\[|\]$/g, ''), tlsP = p.protocol === 'https'
  const s: net.Socket = tlsP ? tls.connect({ host: bare, port: p.port, servername: net.isIP(bare) ? undefined : bare }) : net.connect(p.port, bare)
  o.track?.add(s); s.once('close', () => o.track?.delete(s)); s.on('error', () => {})
  s.setTimeout(o.ms ?? 8000, () => s.destroy(new PErr('TIMEOUT')))
  try {
    await new Promise<void>((r, j) => { s.once(tlsP ? 'secureConnect' : 'connect', () => r()); s.once('error', j) })
    stg.connection = true
    const cred = p.username !== undefined, pw = p.password ?? ''
    if (p.protocol === 'socks5') {
      s.write(Buffer.from(cred ? [5, 2, 0, 2] : [5, 1, 0]))
      const g = await rd(s, 2)
      if (g[0] !== 5) throw new PErr('HANDSHAKE')
      if (g[1] === 0xff) throw new PErr(cred ? 'AUTH_FAILED' : 'AUTH_REQUIRED')
      stg.handshake = true
      if (g[1] === 2) {
        if (!cred) throw new PErr('AUTH_REQUIRED')
        const u = Buffer.from(p.username!), w = Buffer.from(pw)
        s.write(Buffer.concat([Buffer.from([1, u.length]), u, Buffer.from([w.length]), w]))
        if ((await rd(s, 2))[1] !== 0) throw new PErr('AUTH_FAILED')
      }
      stg.auth = true
      const h = Buffer.from(host)
      s.write(Buffer.concat([Buffer.from([5, 1, 0, 3, h.length]), h, Buffer.from([port >> 8, port & 255])]))
      const r = await rd(s, 4)
      if (r[1] !== 0) throw new PErr('CONNECT')
      if (r[3] === 3) await rd(s, (await rd(s, 1))[0] + 2); else await rd(s, r[3] === 1 ? 6 : 18)
    } else if (p.protocol === 'socks4' || p.protocol === 'socks4a') {
      const a4 = p.protocol === 'socks4a' && !net.isIPv4(host)
      const ip = net.isIPv4(host) ? host : a4 ? '0.0.0.1' : (await dns.promises.lookup(host, { family: 4 })).address
      const parts = [Buffer.from([4, 1, port >> 8, port & 255, ...ip.split('.').map(Number)]), Buffer.from(p.username ?? ''), Buffer.from([0])]
      if (a4) parts.push(Buffer.from(host), Buffer.from([0]))
      s.write(Buffer.concat(parts))
      const r = await rd(s, 8)
      stg.handshake = true; stg.auth = true
      if (r[1] === 0x5d) throw new PErr('AUTH_FAILED')
      if (r[1] !== 0x5a) throw new PErr('CONNECT')
    } else {
      const hp = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
      const auth = cred ? `Proxy-Authorization: Basic ${Buffer.from(`${p.username}:${pw}`).toString('base64')}\r\n` : ''
      s.write(`CONNECT ${hp}:${port} HTTP/1.1\r\nHost: ${hp}:${port}\r\n${auth}\r\n`)
      let h = ''
      while (!h.endsWith('\r\n\r\n')) { h += (await rd(s, 1)).toString('latin1'); if (h.length > 8192) throw new PErr('HANDSHAKE') }
      const code = Number(h.slice(9, 12))
      if (!(code >= 100)) throw new PErr('HANDSHAKE')
      stg.handshake = true
      if (code === 407) throw new PErr(cred ? 'AUTH_FAILED' : 'AUTH_REQUIRED')
      stg.auth = true
      if (code !== 200) throw new PErr('CONNECT')
    }
    s.setTimeout(0)
    return s
  } catch (e) { s.destroy(); throw norm(e, stg) }
}

/** Full usability probe: tunnel + TLS + HTTPS request (204) through the proxy. */
export async function probe(p: Target, track?: Set<net.Socket>, host = 'www.gstatic.com', port = 443, ms = 8000) {
  const stg: Stages = {}, t0 = Date.now()
  let s: net.Socket | undefined
  try {
    s = await openTunnel(p, host, port, { stg, ms, track })
    const x = tls.connect({ socket: s, servername: host })
    x.on('error', () => {})
    await new Promise<void>((r, j) => { x.once('secureConnect', () => r()); x.once('error', () => j(new PErr('TLS'))); setTimeout(() => j(new PErr('TIMEOUT')), ms).unref() })
    x.write(`GET /generate_204 HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`)
    const d = await new Promise<Buffer>((r, j) => { x.once('data', r); x.once('error', () => j(new PErr('TLS'))); x.once('close', () => j(new PErr('TLS'))); setTimeout(() => j(new PErr('TIMEOUT')), ms).unref() })
    x.destroy()
    if (!/^HTTP\/1\.[01] (204|200)/.test(d.toString())) throw new PErr('TLS')
    stg.https = true
    return { ok: true as const, latency: Date.now() - t0, stg }
  } catch (e) { s?.destroy(); return { ok: false as const, code: e instanceof PErr ? e.code : 'FAILED', stg } }
}
