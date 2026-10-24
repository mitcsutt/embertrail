import { useCallback, useMemo } from 'react'

import { useRates } from '#features/locale/data/rates'
import { useLocale } from '#features/locale/hooks/useLocale'
import { formatMoney } from '#features/locale/utils/formatMoney'

export type MoneyState =
  /** USD was asked for (or is the locale's currency): nothing to convert. */
  | { kind: 'usd' }
  /** Waiting for the Hub's rates; USD is shown meanwhile. */
  | { kind: 'loading' }
  | { kind: 'converted'; rate: number; date: string; stale: boolean }
  /** Another currency was asked for but the Hub has no rate: USD is shown, and says so. */
  | { kind: 'fallback'; reason: 'off' | 'unavailable' | 'unsupported' }

export interface Money {
  /** What is on screen: the requested currency when converted, else `USD`. */
  currency: string
  /** What the viewer asked for. */
  requested: string
  locale: string
  state: MoneyState
  /** USD to a string: converted and marked `≈` when the state is `converted`. */
  format: (usd: number, digits?: number) => string
  /** USD to the shown currency's amount, for a chart's data. */
  scale: (usd: number) => number
  /** An amount already in the shown currency, with no `≈`: a chart's axis and tooltip. */
  plain: (amount: number) => string
}

/** Every cost in the Dashboard goes through this: Claude Code reports USD, the viewer reads their own. */
export function useMoney(): Money {
  const { locale, currency: requested } = useLocale()
  const rates = useRates()

  const state = useMemo<MoneyState>(() => {
    if (requested === 'USD') return { kind: 'usd' }
    if (rates.isPending) return { kind: 'loading' }
    const data = rates.data
    if (data === undefined) return { kind: 'fallback', reason: 'unavailable' }
    if (data.rates === null || data.date === null) {
      return { kind: 'fallback', reason: data.status === 'off' ? 'off' : 'unavailable' }
    }
    const rate = data.rates[requested]
    if (rate === undefined) return { kind: 'fallback', reason: 'unsupported' }
    return { kind: 'converted', rate, date: data.date, stale: data.status === 'stale' }
  }, [requested, rates.isPending, rates.data])

  const rate = state.kind === 'converted' ? state.rate : undefined
  const currency = rate === undefined ? 'USD' : requested
  const format = useCallback(
    (usd: number, digits?: number) =>
      formatMoney(usd, { locale, currency, rate, ...(digits === undefined ? {} : { digits }) }),
    [locale, currency, rate],
  )
  const scale = useCallback((usd: number) => usd * (rate ?? 1), [rate])
  const plain = useCallback(
    (amount: number) => formatMoney(amount, { locale, currency, rate: undefined, plain: true }),
    [locale, currency],
  )
  return { currency, requested, locale, state, format, scale, plain }
}
