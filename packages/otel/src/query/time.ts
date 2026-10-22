// Time zones and calendar buckets. Postgres buckets in the request's IANA `tz`
// (`date_trunc(unit, time, tz)`: local midnight days, Monday weeks, DST-aware); this file
// checks the zone first and writes each bucket start with the zone's offset at that instant.

import { HubError } from '@mitcsutt/embertrail-hub'

export const buckets = ['minute', 'hour', 'day', 'week', 'month'] as const
export type Bucket = (typeof buckets)[number]

const formats = new Map<string, Intl.DateTimeFormat>()

function formatter(tz: string) {
  let found = formats.get(tz)
  if (found === undefined) {
    found = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'longOffset',
    })
    formats.set(tz, found)
  }
  return found
}

/**
 * Refuses anything but a known IANA zone with 422 `invalid`, before Postgres sees it. A fixed
 * offset such as `+05:00` is refused too: Postgres reads it as a POSIX zone, sign reversed.
 */
export function checkTz(tz: string) {
  let resolved: string
  try {
    resolved = formatter(tz).resolvedOptions().timeZone
  } catch {
    throw HubError.invalid(`Unknown time zone "${tz}"`)
  }
  if (/^[+\-\d]/.test(tz) || /^[+-]/.test(resolved)) {
    throw HubError.invalid(`Time zone "${tz}" is not an IANA zone name`)
  }
}

/** An instant as RFC 3339 in `tz`, with the zone's offset at that instant: `2026-10-25T00:00:00+02:00`. */
export function inZone(instant: Date, tz: string) {
  const found = new Map(
    formatter(tz)
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  )
  const parts = (type: Intl.DateTimeFormatPartTypes) => found.get(type) ?? ''
  // `longOffset` is `GMT+02:00`, or `GMT` at UTC; a zero offset is written `Z`.
  const offset = parts('timeZoneName').replace('GMT', '')
  const zone = offset === '' || offset === '+00:00' ? 'Z' : offset
  const date = `${parts('year')}-${parts('month')}-${parts('day')}`
  return `${date}T${parts('hour')}:${parts('minute')}:${parts('second')}${zone}`
}
