// The Rates Port: daily foreign-exchange rates, so a Dashboard can show the USD costs that
// Claude Code reports in the viewer's own currency. See docs/currency.md.

/** One day's rates, in units of each currency per 1 USD. */
export interface RatesSnapshot {
  /** The day the rates were published for, `YYYY-MM-DD`. */
  date: string
  /** Where they came from. */
  source: 'ecb'
  /** Currency code to units per 1 USD, including `USD` itself (1). */
  rates: Readonly<Record<string, number>>
  /** When the Hub fetched them. */
  fetchedAt: Date
}

export type RatesStatus = 'ok' | 'stale' | 'off' | 'unavailable'

export interface RatesResult {
  /** `ok`: fresh. `stale`: the last good copy, since a refresh failed. `off`: switched off on this Hub. `unavailable`: no copy and the source cannot be reached. */
  status: RatesStatus
  snapshot: RatesSnapshot | null
}

export interface RatesPort {
  get(): Promise<RatesResult>
}

/** The Port for a Hub that makes no outbound request: every answer is `off`. */
export function noRates(): RatesPort {
  return { get: () => Promise.resolve({ status: 'off', snapshot: null }) }
}

export const ecbDailyUrl = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml'

const cubeTime = /<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]/
const cubeRate = /<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]/g

/**
 * The ECB's euro foreign exchange reference rates (`eurofxref-daily.xml`, euro per currency),
 * turned into units per 1 USD. Throws when the document has no date or no USD rate.
 */
export function parseEcb(xml: string): { date: string; rates: Record<string, number> } {
  const date = cubeTime.exec(xml)?.[1]
  if (date === undefined) throw new Error('the ECB document has no date')
  const perEuro: Record<string, number> = { EUR: 1 }
  for (const [, code, rate] of xml.matchAll(cubeRate)) {
    const value = Number(rate)
    if (code !== undefined && Number.isFinite(value) && value > 0) perEuro[code] = value
  }
  const usd = perEuro.USD
  if (usd === undefined) throw new Error('the ECB document has no USD rate')
  const rates: Record<string, number> = {}
  for (const [code, value] of Object.entries(perEuro)) rates[code] = value / usd
  return { date, rates }
}

export interface EcbRatesOptions {
  /** Default: the global `fetch`. */
  fetch?: (url: string, init?: RequestInit) => Promise<Response>
  url?: string
  /** How long a copy is fresh. Default 6 hours: the ECB publishes once each working day. */
  ttlMs?: number
  /** How long to wait after a failed fetch before trying again. Default 1 minute. */
  retryMs?: number
  /** Default 5 seconds. */
  timeoutMs?: number
  clock?: () => Date
}

/**
 * Fetches the ECB's daily reference rates (a public file: no key, and the request carries
 * nothing about the Hub or its data), keeps the last good copy in memory and serves it as
 * `stale` when a refresh fails. Concurrent callers share one fetch.
 */
export function ecbRates(options: EcbRatesOptions = {}): RatesPort {
  const doFetch = options.fetch ?? ((url, init) => fetch(url, init))
  const url = options.url ?? ecbDailyUrl
  const ttlMs = options.ttlMs ?? 6 * 3_600_000
  const retryMs = options.retryMs ?? 60_000
  const timeoutMs = options.timeoutMs ?? 5_000
  const clock = options.clock ?? (() => new Date())

  let current: RatesSnapshot | undefined
  let failedAt = Number.NEGATIVE_INFINITY
  let inflight: Promise<void> | undefined

  async function refresh() {
    try {
      const response = await doFetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: 'application/xml' },
      })
      if (!response.ok) throw new Error(`the ECB answered ${String(response.status)}`)
      const { date, rates } = parseEcb(await response.text())
      current = { date, source: 'ecb', rates, fetchedAt: clock() }
    } catch {
      failedAt = clock().getTime()
    }
  }

  return {
    async get() {
      const now = clock().getTime()
      const fresh = current !== undefined && now - current.fetchedAt.getTime() < ttlMs
      if (!fresh && now - failedAt >= retryMs) {
        inflight ??= refresh().finally(() => {
          inflight = undefined
        })
        await inflight
      }
      if (current === undefined) return { status: 'unavailable', snapshot: null }
      const stale = clock().getTime() - current.fetchedAt.getTime() >= ttlMs
      return { status: stale ? 'stale' : 'ok', snapshot: current }
    },
  }
}
