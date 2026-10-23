import { TZDate } from '@date-fns/tz'
import { addDays, format, startOfDay, startOfWeek, subDays, subWeeks } from 'date-fns'

import type { TimeRange } from '#features/filters/types/filters'
import type { FixedWindow, ResolvedWindow } from '#features/filters/types/window'

const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/

function zoned(at: Date | number, tz: string): TZDate {
  const date = new TZDate(typeof at === 'number' ? at : at.getTime(), tz)
  if (Number.isNaN(date.getTime())) throw new RangeError(`Unknown time zone: ${tz}`)
  return date
}

/** Whether this is a real calendar date written `YYYY-MM-DD`. */
export function isCalendarDate(date: string): boolean {
  const match = datePattern.exec(date)
  if (match === null) return false
  const [, year, month, day] = match.map(Number)
  const utc = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1))
  return (
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === (month ?? 1) - 1 &&
    utc.getUTCDate() === day
  )
}

/** Midnight of a `YYYY-MM-DD` calendar date in the zone. */
function dayStart(date: string, tz: string): TZDate {
  if (!isCalendarDate(date)) throw new RangeError(`Not a calendar date (YYYY-MM-DD): ${date}`)
  const [year, month, day] = date.split('-').map(Number)
  return new TZDate(year ?? 0, (month ?? 1) - 1, day ?? 1, tz)
}

function toWindow(from: Date, to: Date): ResolvedWindow {
  // `getTime` first: a TZDate's own `toISOString` carries the zone's offset, the Hub wants UTC.
  return {
    from: new Date(from.getTime()).toISOString(),
    to: new Date(to.getTime()).toISOString(),
  }
}

/**
 * The window a relative or absolute range means, in `tz`, at `now`.
 *
 * Days are local calendar days, so a day across a clock change is 23 or 25 hours long, and weeks
 * start on Monday. Every range that includes today ends at the start of tomorrow rather than at
 * `now`, so the window (and a Widget's request) stays the same all day. An absolute range is two
 * `YYYY-MM-DD` dates, both inclusive.
 */
export function resolveWindow(range: TimeRange, now: Date, tz: string): ResolvedWindow {
  if (range.kind === 'absolute') {
    const from = dayStart(range.from, tz)
    const last = dayStart(range.to, tz)
    if (last < from) {
      throw new RangeError(`The range ends before it starts: ${range.from} to ${range.to}`)
    }
    return toWindow(from, addDays(last, 1))
  }

  const today = startOfDay(zoned(now, tz))
  const tomorrow = addDays(today, 1)
  switch (range.range) {
    case 'today':
      return toWindow(today, tomorrow)
    case 'yesterday':
      return toWindow(subDays(today, 1), today)
    case 'this-week':
      return toWindow(startOfWeek(today, { weekStartsOn: 1 }), tomorrow)
    case 'last-7-days':
      return toWindow(subDays(today, 6), tomorrow)
    case 'last-30-days':
      return toWindow(subDays(today, 29), tomorrow)
    case 'last-90-days':
      return toWindow(subDays(today, 89), tomorrow)
  }
}

/** The window a Widget with a fixed `window` reads, whatever the Board's range is. */
export function resolveFixedWindow(fixed: FixedWindow, now: Date, tz: string): ResolvedWindow {
  switch (fixed) {
    case 'today':
      return resolveWindow({ kind: 'relative', range: 'today' }, now, tz)
    case 'this-week':
      return resolveWindow({ kind: 'relative', range: 'this-week' }, now, tz)
    case 'last-28-days': {
      const today = startOfDay(zoned(now, tz))
      return toWindow(subDays(today, 27), addDays(today, 1))
    }
    case 'last-12-weeks': {
      const today = startOfDay(zoned(now, tz))
      const thisMonday = startOfWeek(today, { weekStartsOn: 1 })
      return toWindow(subWeeks(thisMonday, 11), addDays(today, 1))
    }
  }
}

/**
 * The calendar dates (`YYYY-MM-DD`, both inclusive) a range covers in `tz`: what the custom range
 * picker shows when someone switches a relative range to a custom one.
 */
export function absoluteRange(
  range: TimeRange,
  now: Date,
  tz: string,
): { kind: 'absolute'; from: string; to: string } {
  if (range.kind === 'absolute') return range
  const { from, to } = resolveWindow(range, now, tz)
  const day = 'yyyy-MM-dd'
  // `to` is exclusive: the last day is the one that holds the instant just before it.
  return {
    kind: 'absolute',
    from: format(zoned(Date.parse(from), tz), day),
    to: format(zoned(Date.parse(to) - 1, tz), day),
  }
}
