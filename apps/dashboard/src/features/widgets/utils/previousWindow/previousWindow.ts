import { TZDate } from '@date-fns/tz'
import { differenceInCalendarDays, subDays } from 'date-fns'

import type { QueryContext } from '#features/filters/types/filters'

/** A window to compare with: `from` inclusive, `to` exclusive, as ISO times with the zone's offset. */
export interface ComparisonWindow {
  from: string
  to: string
  /** How many local days the window spans; the window before it spans as many. */
  days: number
}

/**
 * The window of the same number of local days that ends where this one starts: the last 7 days
 * compare with the 7 before them, today with yesterday. Days are counted in `ctx.tz`, so a window
 * across a clock change is still a whole number of days, and the previous one starts at a local
 * midnight too.
 */
export function previousWindow(ctx: Pick<QueryContext, 'from' | 'to' | 'tz'>): ComparisonWindow {
  const from = new TZDate(Date.parse(ctx.from), ctx.tz)
  const to = new TZDate(Date.parse(ctx.to), ctx.tz)
  const days = Math.max(1, differenceInCalendarDays(to, from))
  return { from: subDays(from, days).toISOString(), to: ctx.from, days }
}
