import { describe, it, expect } from 'vitest'
import * as S from './proxy'
const ok = (s: string, infer: S.Infer = 'off') => { const r = S.parseProxy(s, infer); if (!r.ok) throw new Error(r.error); return r.rec }
const bad = (s: string, infer: S.Infer = 'off') => !S.parseProxy(s, infer).ok
const mk = (id: string, status: S.Status, latency?: number, o: Partial<S.ProxyEntry> = {}): S.ProxyEntry =>
  ({ id, protocol: 'socks5', host: 'h', port: 1, source: 'Manual', createdAt: 0, updatedAt: 0, status, latency, failures: 0, successes: 0, uses: 0, ...o })

describe('URI parsing', () => {
  it('schemes', () => {
    expect(ok('socks5://192.111.135.17:18302')).toEqual({ protocol: 'socks5', host: '192.111.135.17', port: 18302 })
    expect(ok('SOCKS5://1.2.3.4:1080').protocol).toBe('socks5')
    for (const p of ['socks4', 'socks4a', 'http', 'https']) expect(ok(`${p}://1.2.3.4:8080`).protocol).toBe(p)
  })
  it('credentials and decoding', () => {
    expect(ok('socks5://user%40name:p%40ss@1.2.3.4:1080')).toMatchObject({ username: 'user@name', password: 'p@ss' })
    expect(ok('http://u:p%3Aw@h.example.com:8080')).toMatchObject({ username: 'u', password: 'p:w' })
  })
  it('IPv6 and hostnames', () => {
    expect(ok('socks5://[2001:db8::1]:1080')).toMatchObject({ host: '[2001:db8::1]', port: 1080 })
    expect(ok('socks5://u:p@[::1]:9')).toMatchObject({ host: '[::1]', username: 'u' })
    expect(ok('http://proxy.example.com:3128').host).toBe('proxy.example.com')
  })
  it('raw inference policy', () => {
    expect(bad('1.2.3.4:1080')).toBe(true)
    expect(ok('1.2.3.4:1080', 'socks5').protocol).toBe('socks5')
    expect(ok('example.com:8080', 'http').protocol).toBe('http')
    expect(ok('u:p@1.2.3.4:1080', 'socks5').username).toBe('u')
  })
  it('rejects invalid', () => {
    for (const s of ['socks5://1.2.3.4:0', 'socks5://1.2.3.4:70000', 'socks5://1.2.3.4', 'socks5://999.1.1.1:80', 'ftp://1.2.3.4:21', 'socks5://bad host:1', 'garbage', '', 'socks5://u:p%ZZ@1.2.3.4:1', 'socks5://:pw@1.2.3.4:1'])
      expect(bad(s, 'socks5')).toBe(true)
  })
})
describe('Telegram', () => {
  it('socks', () => {
    expect(ok('tg://socks?server=1.2.3.4&port=1080')).toEqual({ protocol: 'socks5', host: '1.2.3.4', port: 1080 })
    expect(ok('https://t.me/socks?server=h.com&port=1&user=a%40b&pass=p%26')).toMatchObject({ protocol: 'socks5', username: 'a@b', password: 'p&' })
  })
  it('mtproto is not socks', () => {
    const r = ok('tg://proxy?server=h.com&port=443&secret=ee00')
    expect(r.protocol).toBe('mtproto'); expect(S.browserCapable(r)).toBe(false); expect(S.telegramSocks(r)).toBe(false)
    expect(bad('tg://proxy?server=h.com&port=443')).toBe(true)
  })
  it('invalid', () => { for (const s of ['tg://socks?port=1', 'tg://socks?server=h&port=x', 'tg://socks?server=h&port=1&user=u', 'tg://other?server=h&port=1']) expect(bad(s)).toBe(true) })
})
describe('conversion', () => {
  it('socks5 -> tg://socks only', () => {
    expect(S.toTelegramSocks(ok('socks5://1.2.3.4:1080'))).toBe('tg://socks?server=1.2.3.4&port=1080')
    const t = S.toTelegramSocks(ok('socks5://user%40n:p%26w@1.2.3.4:1080'), true)!
    expect(t).toBe('tg://socks?server=1.2.3.4&port=1080&user=user%40n&pass=p%26w')
    expect(ok(t)).toMatchObject({ username: 'user@n', password: 'p&w' }) // round trip
    expect(S.toTelegramSocks(ok('socks5://u:p@1.2.3.4:1080'))).not.toContain('pass')
  })
  it('refuses other protocols', () => { for (const p of ['http', 'https', 'socks4', 'socks4a']) expect(S.toTelegramSocks(ok(`${p}://1.2.3.4:80`))).toBeNull() })
  it('uri export hides creds by default', () => {
    expect(S.toUri(ok('http://u:p@1.2.3.4:80'))).toBe('http://1.2.3.4:80')
    expect(S.toUri(ok('http://u:p@1.2.3.4:80'), { creds: true })).toBe('http://u:p@1.2.3.4:80')
  })
})
describe('bulk import', () => {
  const txt = '\uFEFFsocks5://1.2.3.4:1080\r\n\r\n  http://5.6.7.8:8080  \r\nSOCKS5://1.2.3.4:1080\r\nnope\r\nsocks4://9.9.9.9:4145\r\n# c\r\ntg://proxy?server=a.com&port=1&secret=ee'
  it('TXT: BOM, CRLF, blanks, dupes, bad lines', () => {
    const s = S.summarize(S.parseText(txt), new Set())
    expect(s).toMatchObject({ total: 6, valid: 5, invalid: 1, duplicates: 1, byProtocol: { socks5: 1, http: 1, socks4: 1, mtproto: 1 } })
  })
  it('existing records count as duplicates', () => {
    expect(S.summarize(S.parseText('socks5://1.2.3.4:1080'), new Set([S.keyOf(ok('socks5://1.2.3.4:1080'))])).duplicates).toBe(1)
  })
  it('distinct credentials are not merged; password never in id', () => {
    const a = ok('socks5://u1:x@1.2.3.4:1'), b = ok('socks5://u2:x@1.2.3.4:1'), c = ok('socks5://u1:y@1.2.3.4:1')
    expect(S.idOf(a)).not.toBe(S.idOf(b)); expect(S.idOf(a)).toBe(S.idOf(c)); expect(S.idOf(a)).not.toContain('x')
  })
  it('JSON variants', () => {
    const j = (x: unknown) => S.parseText(JSON.stringify(x), 'off').filter((r) => r.ok).map((r: any) => r.rec)
    expect(j([{ protocol: 'socks5', host: '1.2.3.4', port: 1080 }])[0]).toMatchObject({ protocol: 'socks5', host: '1.2.3.4' })
    expect(j([{ protocol: 'http', ip: '5.6.7.8', port: '8080', user: 'a', pass: 'b' }])[0]).toMatchObject({ host: '5.6.7.8', port: 8080, username: 'a', password: 'b' })
    expect(j({ proxies: [{ type: 'SOCKS4', hostname: 'a.com', port: 1 }] })[0].protocol).toBe('socks4')
    expect(j([{ proxy: 'socks5://1.2.3.4:1' }, { url: 'http://1.2.3.4:2' }, 'socks4://1.2.3.4:3']).length).toBe(3)
    expect(j({ data: { items: [{ server: 'a.com', port: 1, protocols: ['https'] }] } })[0].protocol).toBe('https')
    expect(j([{ host: '1.2.3.4', port: 1 }]).length).toBe(0)
    expect(S.parseText('[2001:db8::1]:1080', 'socks5')[0].ok).toBe(true) // not mistaken for JSON
  })
  it('large synthetic input parses fast, isolating bad rows', () => {
    const lines = Array.from({ length: 60000 }, (_, i) => (i % 10 === 0 ? 'junk' + i : `${['socks5', 'http', 'socks4'][i % 3]}://10.${(i >> 8) & 255}.${i & 255}.1:${1000 + (i % 5000)}`)).join('\n')
    const t = Date.now(), s = S.summarize(S.parseText(lines), new Set())
    expect(s.total).toBe(60000); expect(s.invalid).toBe(6000); expect(s.valid).toBe(54000); expect(Date.now() - t).toBeLessThan(5000)
  })
})
describe('classification, ranking, failover', () => {
  it('capabilities', () => {
    expect(S.browserCapable(ok('http://1.2.3.4:80'))).toBe(true); expect(S.telegramSocks(ok('http://1.2.3.4:80'))).toBe(false)
    expect(S.telegramSocks(ok('socks4://1.2.3.4:80'))).toBe(false); expect(S.telegramSocks(ok('socks5://1.2.3.4:80'))).toBe(true)
  })
  it('status codes', () => { expect(S.statusFromCode('AUTH_REQUIRED')).toBe('auth_required'); expect(S.statusFromCode('TIMEOUT')).toBe('timeout'); expect(S.statusFromCode('CONNECT')).toBe('failed'); expect(S.statusFromLatency(801)).toBe('slow') })
  it('reliability beats raw latency', () => {
    const a = mk('A', 'healthy', 70, { successes: 2, failures: 8 }), b = mk('B', 'healthy', 95, { successes: 99, failures: 1 })
    expect(S.pickBest([a, b])?.id).toBe('B')
  })
  it('only usable browser-capable proxies are candidates', () => {
    const l = [mk('f', 'failed', 10), mk('ar', 'auth_required'), mk('m', 'healthy', 1, { protocol: 'mtproto' }), mk('u', 'unknown'), mk('ok', 'slow', 900)]
    expect(S.pickBest(l)?.id).toBe('ok'); expect(S.nextFailover(l, 'ok')).toBeNull()
  })
  it('failover gating: threshold, cooldown, loop prevention', () => {
    const b = { fails: 3, threshold: 3, now: 1e6, lastSwitchAt: 0, cooldownMs: 30000, switchTimes: [] as number[], maxPer5min: 4 }
    expect(S.shouldFailover(b)).toBe(true); expect(S.shouldFailover({ ...b, fails: 2 })).toBe(false)
    expect(S.shouldFailover({ ...b, lastSwitchAt: 1e6 - 1000 })).toBe(false)
    expect(S.shouldFailover({ ...b, switchTimes: [1e6 - 10, 1e6 - 20, 1e6 - 30, 1e6 - 40] })).toBe(false)
    expect(S.shouldFailover({ ...b, switchTimes: [1e6 - 400000] })).toBe(true)
  })
  it('only proxy-class net errors count as failures', () => { expect(S.isProxyError(-130)).toBe(true); expect(S.isProxyError(-105)).toBe(false); expect(S.isProxyError(-3)).toBe(false) })
  it('filters and sorting', () => {
    const l = [mk('a', 'healthy', 300), mk('b', 'healthy', 50, { username: 'u' }), mk('c', 'failed')]
    expect(l.filter((p) => S.matchFilter(p, 'working')).length).toBe(2); expect(l.filter((p) => S.matchFilter(p, 'fast')).map((p) => p.id)).toEqual(['b'])
    expect(S.sortList([...l], 'latency').map((p) => p.id)).toEqual(['b', 'a', 'c']); expect(l.filter((p) => S.matchFilter(p, 'auth')).length).toBe(1)
  })
  it('public model hides secrets', () => {
    const j = JSON.stringify(S.toPublic(mk('x', 'healthy', 5, { username: 'user', password: 'hunter2', secret: 'sss' }), null))
    expect(j).not.toContain('hunter2'); expect(j).not.toContain('sss'); expect(j).not.toContain('user"')
  })
  it('address bar detection', () => { expect(S.isProxyUri('socks5://1.2.3.4:1')).toBe(true); expect(S.isProxyUri('tg://proxy?x')).toBe(true); expect(S.isProxyUri('https://example.com')).toBe(false) })
})
