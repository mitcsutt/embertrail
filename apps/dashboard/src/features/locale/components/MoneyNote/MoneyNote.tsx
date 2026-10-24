import { Text } from '@mitcsutt/kiln-ui'

import { useMoney } from '#features/locale/hooks/useMoney'
import type { MoneyState } from '#features/locale/hooks/useMoney'

/** The date as the viewer writes it, in UTC: the ECB's date is a calendar day, not an instant. */
const day = (date: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  )

const why: Record<Extract<MoneyState, { kind: 'fallback' }>['reason'], string> = {
  off: 'this Hub does not fetch exchange rates',
  unavailable: 'exchange rates are not available right now',
  unsupported: 'there is no exchange rate for it',
}

/**
 * Says what the costs on screen are: a converted figure is an estimate at a dated rate, and a
 * currency the Hub could not convert stays USD. Nothing for USD.
 */
export function MoneyNote() {
  const { state, requested, locale } = useMoney()
  if (state.kind === 'converted') {
    return (
      <Text size="sm" tone="muted" role="note" data-testid="money-note">
        Costs are estimates in {requested}, converted from USD at 1 USD = {state.rate.toFixed(4)}{' '}
        {requested} (ECB reference rate, {day(state.date, locale)}
        {state.stale ? ', the latest this Hub could fetch' : ''}).
      </Text>
    )
  }
  if (state.kind === 'fallback') {
    return (
      <Text size="sm" tone="muted" role="note" data-testid="money-note">
        Showing USD, as Claude Code reports it: you asked for {requested}, but {why[state.reason]}.
      </Text>
    )
  }
  return null
}
