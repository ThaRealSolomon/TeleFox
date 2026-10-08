import { describe, it, expect, afterAll } from 'vitest'
import net from 'node:net'
import { openTunnel, PErr } from './tunnel'

// Local protocol servers: real sockets, no external network.
const servers: net.Server[] = []
const listen = (h: (s: net.Socket) => void) => new Promise<number>((r) => { const s = net.createServer(h); servers.push(s); s.listen(0, '127.0.0.1', () => r((s.address() as net.AddressInfo).port)) })
afterAll(() => servers.forEach((s) => s.close()))
const echo = () => listen((s) => s.on('data', (d) => s.write(d)))
const once = (s: net.Socket, n: number) => new Promise<Buffer>((r) => { const t = () => { const b = s.read(n); if (b) { s.off('readable', t); r(b) } }; s.on('readable', t); t() })
const socks5 = (auth?: [string, string]) => listen(async (c) => {
  const g = await once(c, 2); const m = await once(c, g[1])
  if (auth) {
    if (!m.includes(2)) return c.end(Buffer.from([5, 0xff]))
    c.write(Buffer.from([5, 2])); const v = await once(c, 2); const u = await once(c, v[1]); const pl = await once(c, 1); const p = await once(c, pl[0])
    if (u.toString() !== auth[0] || p.toString() !== auth[1]) return c.end(Buffer.from([1, 1]))
    c.write(Buffer.from([1, 0]))
  } else c.write(Buffer.from([5, 0]))
  const q = await once(c, 4); const l = (await once(c, 1))[0]; await once(c, l); const port = (await once(c, 2)).readUInt16BE(0)
  const up = net.connect(port, '127.0.0.1', () => { c.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0])); c.pipe(up); up.pipe(c) }); void q
})
const httpProxy = (auth?: string) => listen((c) => c.once('data', (d) => {
  const t = d.toString(); const m = /CONNECT (.+):(\d+)/.exec(t)!
  if (auth && !t.includes(`Basic ${Buffer.from(auth).toString('base64')}`)) return c.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n')
  const up = net.connect(Number(m[2]), '127.0.0.1', () => { c.write('HTTP/1.1 200 OK\r\n\r\n'); c.pipe(up); up.pipe(c) })
}))
const socks4 = () => listen(async (c) => { const h = await once(c, 8); await once(c, 1); const port = h.readUInt16BE(2)
  const up = net.connect(port, '127.0.0.1', () => { c.write(Buffer.from([0, 0x5a, 0, 0, 0, 0, 0, 0])); c.pipe(up); up.pipe(c) }) })
async function roundTrip(t: any, ep: number) { const s = await openTunnel(t, '127.0.0.1', ep); s.write('hi'); const r = await once(s, 2); s.destroy(); return r.toString() }
const code = async (t: any, ep: number) => { try { await openTunnel(t, '127.0.0.1', ep); return 'OK' } catch (e) { return (e as PErr).code } }

describe('tunnel (real sockets)', () => {
  it('socks5 without auth', async () => { const e = await echo(); expect(await roundTrip({ protocol: 'socks5', host: '127.0.0.1', port: await socks5() }, e)).toBe('hi') })
  it('socks5 AUTH_REQUIRED / AUTH_FAILED / supplied creds', async () => {
    const e = await echo(), p = await socks5(['u', 'p'])
    expect(await code({ protocol: 'socks5', host: '127.0.0.1', port: p }, e)).toBe('AUTH_REQUIRED')
    expect(await code({ protocol: 'socks5', host: '127.0.0.1', port: p, username: 'u', password: 'bad' }, e)).toBe('AUTH_FAILED')
    expect(await roundTrip({ protocol: 'socks5', host: '127.0.0.1', port: p, username: 'u', password: 'p' }, e)).toBe('hi')
  })
  it('http CONNECT incl. 407', async () => {
    const e = await echo(), p = await httpProxy('a:b')
    expect(await code({ protocol: 'http', host: '127.0.0.1', port: p }, e)).toBe('AUTH_REQUIRED')
    expect(await code({ protocol: 'http', host: '127.0.0.1', port: p, username: 'a', password: 'x' }, e)).toBe('AUTH_FAILED')
    expect(await roundTrip({ protocol: 'http', host: '127.0.0.1', port: p, username: 'a', password: 'b' }, e)).toBe('hi')
  })
  it('socks4', async () => { const e = await echo(); expect(await roundTrip({ protocol: 'socks4', host: '127.0.0.1', port: await socks4() }, e)).toBe('hi') })
  it('dead port is UNREACHABLE', async () => { expect(await code({ protocol: 'socks5', host: '127.0.0.1', port: 1 }, 80)).toBe('UNREACHABLE') })
})
