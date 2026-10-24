import { afterEach, describe, expect, it, vi } from 'vitest'

import { testHub } from '../testing/test-hub'
import type { TestHub } from '../testing/test-hub'
import { ecbRates, noRates, parseEcb } from './rates'
import type { RatesPort } from './rates'

const xml = (date: string, usd: string, aud: string) => `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <gesmes:subject>Reference rates</gesmes:subject>
  <Cube>
    <Cube time='${date}'>
      <Cube currency='USD' rate='${usd}'/>
      <Cube currency='JPY' rate='160.5'/>
      <Cube currency='AUD' rate='${aud}'/>
    </Cube>
  </Cube>
</gesmes:Envelope>`

describe('parseEcb', () => {
  it('turns euro-based rates into units per US dollar', () => {
    const { date, rates } = parseEcb(xml('2026-10-23', '1.25', '2.0'))
    expect(date).toBe('2026-10-23')
    expect(rates.USD).toBe(1)
    expect(rates.AUD).toBeCloseTo(1.6)
    expect(rates.EUR).toBeCloseTo(0.8)
    expect(rates.JPY).toBeCloseTo(128.4)
  })

  it('refuses a document without a date or a USD rate', () => {
    expect(() => parseEcb('<Cube><Cube currency="USD" rate="1.1"/></Cube>')).toThrow(/no date/)
    expect(() =>
      parseEcb("<Cube time='2026-10-23'><Cube currency='AUD' rate='1.6'/></Cube>"),
    ).toThrow(/no USD rate/)
  })
})

describe('ecbRates', () => {
  const hour = 3_600_000
  const ok = (body: string) => Promise.resolve(new Response(body))

  function setup(responses: (() => Promise<Response>)[]) {
    let now = Date.parse('2026-10-24T00:00:00Z')
    const fetch = vi.fn(() => (responses.shift() ?? responses[0] ?? (() => ok('')))())
    const port = ecbRates({ fetch, clock: () => new Date(now), ttlMs: 6 * hour, retryMs: 60_000 })
    return {
      port,
      fetch,
      advance(ms: number) {
        now += ms
      },
    }
  }

  it('fetches once, then serves the cache until it expires', async () => {
    const s = setup([
      () => ok(xml('2026-10-23', '1.25', '2.0')),
      () => ok(xml('2026-10-24', '1.0', '1.6')),
    ])
    const first = await s.port.get()
    expect(first.status).toBe('ok')
    expect(first.snapshot).toMatchObject({ date: '2026-10-23', source: 'ecb' })
    await s.port.get()
    expect(s.fetch).toHaveBeenCalledTimes(1)
    s.advance(7 * hour)
    expect((await s.port.get()).snapshot?.date).toBe('2026-10-24')
    expect(s.fetch).toHaveBeenCalledTimes(2)
  })

  it('shares one fetch between concurrent callers', async () => {
    const s = setup([() => ok(xml('2026-10-23', '1.25', '2.0'))])
    await Promise.all([s.port.get(), s.port.get(), s.port.get()])
    expect(s.fetch).toHaveBeenCalledTimes(1)
  })

  it('is unavailable when the first fetch fails, and retries after the back-off', async () => {
    const s = setup([
      () => Promise.reject(new Error('offline')),
      () => ok(xml('2026-10-23', '1.25', '2.0')),
    ])
    await expect(s.port.get()).resolves.toEqual({ status: 'unavailable', snapshot: null })
    await s.port.get()
    expect(s.fetch).toHaveBeenCalledTimes(1)
    s.advance(61_000)
    expect((await s.port.get()).status).toBe('ok')
  })

  it('serves the last good copy as stale when a refresh fails or the file is bad', async () => {
    const s = setup([
      () => ok(xml('2026-10-23', '1.25', '2.0')),
      () => Promise.resolve(new Response('nope', { status: 503 })),
      () => ok('<html>not rates</html>'),
    ])
    await s.port.get()
    s.advance(7 * hour)
    const stale = await s.port.get()
    expect(stale.status).toBe('stale')
    expect(stale.snapshot?.date).toBe('2026-10-23')
    s.advance(61_000)
    expect((await s.port.get()).status).toBe('stale')
  })
})

describe('GET /api/v1/rates', () => {
  let t: TestHub | undefined
  afterEach(async () => {
    await t?.close()
    t = undefined
  })
  const start = async (rates?: RatesPort) => {
    t = await testHub({ modules: [], ...(rates === undefined ? {} : { rates }) })
    return t
  }

  it('answers `off` and no rates when the Hub makes no outbound request', async () => {
    const hub = await start(noRates())
    const response = await hub.as('solo', ['sql:read']).get('/api/v1/rates')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      status: 'off',
      base: 'USD',
      source: null,
      date: null,
      fetched_at: null,
      rates: null,
    })
  })

  it('answers the rates to any authenticated caller, whatever Scopes the Token holds', async () => {
    const fetchedAt = new Date('2026-10-24T01:00:00Z')
    const hub = await start({
      get: () =>
        Promise.resolve({
          status: 'ok',
          snapshot: { date: '2026-10-23', source: 'ecb', rates: { USD: 1, AUD: 1.6 }, fetchedAt },
        }),
    })
    const response = await hub.as('solo', ['sql:read']).get('/api/v1/rates')
    expect(await response.json()).toEqual({
      status: 'ok',
      base: 'USD',
      source: 'ecb',
      date: '2026-10-23',
      fetched_at: fetchedAt.toISOString(),
      rates: { USD: 1, AUD: 1.6 },
    })
  })

  it('needs a caller', async () => {
    const hub = await start()
    expect((await hub.anonymous.get('/api/v1/rates')).status).toBe(401)
  })

  it('refuses a Token bound to a Source', async () => {
    const hub = await start()
    const ingest = hub.as('solo', ['sql:read'], { sourceId: 'laptop' })
    expect((await ingest.get('/api/v1/rates')).status).toBe(403)
  })
})
