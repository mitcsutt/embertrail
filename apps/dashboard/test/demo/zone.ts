// Calendar days in an IANA zone, without a date library: the demo data follows a local working day,
// and the facts it guarantees are totals over local days, which are 23 or 25 hours across DST.

export interface CalendarDate {
  year: number
  /** 1 to 12. */
  month: number
  day: number
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function parts(tz: string, at: Date): Record<string, number> {
  let format = formatters.get(tz)
  if (format === undefined) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
    formatters.set(tz, format)
  }
  const found: Record<string, number> = {}
  for (const part of format.formatToParts(at)) found[part.type] = Number(part.value)
  return found
}

/** The zone's offset from UTC at this instant, in milliseconds. */
function offsetMs(tz: string, at: Date): number {
  const local = parts(tz, at)
  const asUtc = Date.UTC(
    local.year ?? 0,
    (local.month ?? 1) - 1,
    local.day ?? 1,
    local.hour ?? 0,
    local.minute ?? 0,
    local.second ?? 0,
  )
  return asUtc - Math.floor(at.getTime() / 1000) * 1000
}

/** The instant the zone's wall clock reads this date and time. */
export function zonedTime(tz: string, date: CalendarDate, hour = 0, minute = 0): Date {
  const wall = Date.UTC(date.year, date.month - 1, date.day, hour, minute)
  // The offset belongs to the instant, not the wall time: correct once, then again at the result.
  const first = wall - offsetMs(tz, new Date(wall))
  return new Date(wall - offsetMs(tz, new Date(first)))
}

/** The zone's calendar date at this instant. */
export function localDate(tz: string, at: Date): CalendarDate {
  const local = parts(tz, at)
  return { year: local.year ?? 0, month: local.month ?? 1, day: local.day ?? 1 }
}

/** The date `days` after (or before, when negative) this one. */
export function addDays(date: CalendarDate, days: number): CalendarDate {
  const moved = new Date(Date.UTC(date.year, date.month - 1, date.day + days))
  return { year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1, day: moved.getUTCDate() }
}

/** 0 for Sunday to 6 for Saturday. */
export function weekday(date: CalendarDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay()
}

/** The Monday on or before this date, which is where the Query API's weeks start. */
export function weekStart(date: CalendarDate): CalendarDate {
  return addDays(date, -((weekday(date) + 6) % 7))
}

/** `[start of the date, start of the next date)` in the zone. */
export function dayBounds(tz: string, date: CalendarDate): { from: Date; to: Date } {
  return { from: zonedTime(tz, date), to: zonedTime(tz, addDays(date, 1)) }
}

/** The instant the zone's offset changes within `[from, to)`, to the minute, if it does. */
export function offsetChange(tz: string, from: Date, to: Date): Date | undefined {
  const before = offsetMs(tz, from)
  if (offsetMs(tz, new Date(to.getTime() - 1)) === before) return undefined
  let low = from.getTime()
  let high = to.getTime()
  while (high - low > 60_000) {
    const middle = low + Math.floor((high - low) / 120_000) * 60_000
    if (offsetMs(tz, new Date(middle)) === before) low = middle
    else high = middle
  }
  return new Date(high)
}
