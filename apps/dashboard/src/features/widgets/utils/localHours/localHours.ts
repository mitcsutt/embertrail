import { TZDate } from '@date-fns/tz'

import type { QueryContext } from '#features/filters/types/filters'

// Hourly buckets come back with the zone's offset at each instant, so the local hour of a bucket is
// read from its instant in the zone, never from the string. A clock change makes a day 23 or 25
// hours: the hour that is skipped has no bucket, and the hour that repeats has two.

/** One hourly bucket of an aggregate: its start (an ISO time with an offset) and its value. */
export interface HourBucket {
  start: string
  value: number
}

/** The local calendar day (`2026-11-01`), hour (0 to 23) and weekday (Monday is 0) at an instant. */
export function localHour(instant: string | number | Date, tz: string) {
  const at = new TZDate(new Date(instant).getTime(), tz)
  const month = String(at.getMonth() + 1).padStart(2, '0')
  const date = String(at.getDate()).padStart(2, '0')
  return {
    day: `${String(at.getFullYear())}-${month}-${date}`,
    hour: at.getHours(),
    weekday: (at.getDay() + 6) % 7,
  }
}

/** Seven weekdays (Monday first) of 24 hours: the sum of the buckets that fall in each cell. */
export function foldWeek(buckets: readonly HourBucket[], tz: string): number[][] {
  const cells = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0))
  for (const { start, value } of buckets) {
    const { weekday, hour } = localHour(start, tz)
    const row = cells[weekday]
    if (row !== undefined) row[hour] = (row[hour] ?? 0) + value
  }
  return cells
}

export interface HourOfDay {
  hour: number
  /** Today's total in this hour; `null` for an hour not reached yet, or skipped by a clock change. */
  today: number | null
  /** The mean over the other days that have this hour; `null` when none does. */
  typical: number | null
}

/**
 * Today against a typical day, per local hour. Typical is the mean of the window's other days: a
 * day without data in an hour counts as zero, but a day that has no such hour (the one a clock
 * change skips) is left out of that hour's mean. On a day with a repeated hour, both occurrences
 * add up in that hour.
 */
export function todayVsTypical(
  buckets: readonly HourBucket[],
  ctx: Pick<QueryContext, 'from' | 'to' | 'tz' | 'now'>,
): HourOfDay[] {
  const today = localHour(ctx.now, ctx.tz)

  // Every (day, hour) the window holds, found by walking it an hour at a time from local midnight.
  const exists = new Set<string>()
  const days = new Map<number, Set<string>>()
  for (let at = Date.parse(ctx.from); at < Date.parse(ctx.to); at += 3_600_000) {
    const { day, hour } = localHour(at, ctx.tz)
    exists.add(`${day}|${String(hour)}`)
    if (day !== today.day) {
      const found = days.get(hour) ?? new Set<string>()
      found.add(day)
      days.set(hour, found)
    }
  }

  const totals = new Map<string, number>()
  for (const { start, value } of buckets) {
    const { day, hour } = localHour(start, ctx.tz)
    const key = `${day}|${String(hour)}`
    totals.set(key, (totals.get(key) ?? 0) + value)
  }

  return Array.from({ length: 24 }, (_, hour) => {
    const others = days.get(hour) ?? new Set<string>()
    let sum = 0
    for (const day of others) sum += totals.get(`${day}|${String(hour)}`) ?? 0
    const reached = hour <= today.hour && exists.has(`${today.day}|${String(hour)}`)
    return {
      hour,
      today: reached ? (totals.get(`${today.day}|${String(hour)}`) ?? 0) : null,
      typical: others.size === 0 ? null : sum / others.size,
    }
  })
}
