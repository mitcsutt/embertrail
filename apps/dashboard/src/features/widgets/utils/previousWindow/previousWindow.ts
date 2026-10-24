import { TZDate } from '@date-fns/tz'
import { differenceInCalendarDays, subDays } from 'date-fns'

import type { QueryContext } from '#features/filters/types/filters'

/** A window to compare with: `from` inclusive, `to` exclusive, as ISO times with the zone's offset. */
export interface ComparisonWindow {
  from: string
  to: string
  /** How many local days the window spans; the window before it spans as many. */
  days: number
  /** Where the compared part of the Board's window ends: `to`, or now while the window is still running. */
  until: string
  /** Where the compared part of this window ends: the same time into it as `until` is into the Board's window. */
  previousUntil: string
}

/**
 * The window of the same number of local days that ends where this one starts: the last 7 days
 * compare with the 7 before them, today with yesterday. Days are counted in `ctx.tz`, so a window
 * across a clock change is still a whole number of days, and the previous one starts at a local
 * midnight too. While the Board's window is still running, both are compared over the same time
 * into them (`until`, `previousUntil`), so the hours not yet lived do not read as a drop.
 */
export function previousWindow(
  ctx: Pick<QueryContext, 'from' | 'to' | 'tz' | 'now'>,
): ComparisonWindow {
  const from = new TZDate(Date.parse(ctx.from), ctx.tz)
  const to = new TZDate(Date.parse(ctx.to), ctx.tz)
  const days = Math.max(1, differenceInCalendarDays(to, from))
  const previousFrom = subDays(from, days)
  const elapsed =
    Math.min(Math.max(ctx.now.getTime(), from.getTime()), to.getTime()) - from.getTime()
  const running = elapsed < to.getTime() - from.getTime()
  return {
    from: previousFrom.toISOString(),
    to: ctx.from,
    days,
    until: running ? new Date(from.getTime() + elapsed).toISOString() : ctx.to,
    previousUntil: running
      ? subDays(new TZDate(from.getTime() + elapsed, ctx.tz), days).toISOString()
      : ctx.from,
  }
}
