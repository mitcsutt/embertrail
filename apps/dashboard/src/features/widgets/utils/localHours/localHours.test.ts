import { describe, expect, it } from 'vitest'

import { foldWeek, localHour, todayVsTypical } from './localHours'
import type { HourBucket } from './localHours'

const hour = 3_600_000

/** One bucket for every hour of the window, each worth its own index, starting at `from`. */
function everyHour(from: string, to: string): HourBucket[] {
  const buckets: HourBucket[] = []
  for (let at = Date.parse(from), n = 0; at < Date.parse(to); at += hour, n += 1) {
    buckets.push({ start: new Date(at).toISOString(), value: 1 })
  }
  return buckets
}

describe('localHour', () => {
  it('reads the day, hour and weekday on the zone’s wall clock, not from the offset written', () => {
    // 23:30 UTC on a Saturday is 00:30 on Sunday in Berlin and 19:30 on Saturday in New York.
    const at = '2026-10-31T23:30:00Z'
    expect(localHour(at, 'Europe/Berlin')).toEqual({ day: '2026-11-01', hour: 0, weekday: 6 })
    expect(localHour(at, 'America/New_York')).toEqual({ day: '2026-10-31', hour: 19, weekday: 5 })
  })
})

describe('foldWeek', () => {
  // 29 March 2026 is Berlin's 23 hour day and 25 October its 25 hour day; 8 March and 1 November
  // are New York's.
  const days = [
    ['Europe/Berlin', '2026-03-29T00:00:00+01:00', '2026-03-30T00:00:00+02:00', 23, 6],
    ['Europe/Berlin', '2026-10-25T00:00:00+02:00', '2026-10-26T00:00:00+01:00', 25, 6],
    ['America/New_York', '2026-03-08T00:00:00-05:00', '2026-03-09T00:00:00-04:00', 23, 6],
    ['America/New_York', '2026-11-01T00:00:00-04:00', '2026-11-02T00:00:00-05:00', 25, 6],
  ] as const

  it.each(days)(
    '%s: a %s day of hourly buckets folds into its weekday',
    (tz, from, to, hours, weekday) => {
      const cells = foldWeek(everyHour(from, to), tz)
      expect(cells[weekday]?.reduce((total, value) => total + value, 0)).toBe(hours)
      // Nothing leaks into the other days.
      expect(cells.flat().reduce((total, value) => total + value, 0)).toBe(hours)
    },
  )

  it('skips the hour a clock change skips and doubles the hour it repeats', () => {
    const spring = foldWeek(everyHour(...rangeOf(days[0])), 'Europe/Berlin')[6]
    expect(spring?.[2]).toBe(0)
    expect(spring?.[3]).toBe(1)
    const autumn = foldWeek(everyHour(...rangeOf(days[1])), 'Europe/Berlin')[6]
    expect(autumn?.[2]).toBe(2)
    const newYork = foldWeek(everyHour(...rangeOf(days[3])), 'America/New_York')[6]
    expect(newYork?.[1]).toBe(2)
  })

  it('adds buckets that share a weekday and hour', () => {
    const buckets = [
      { start: '2026-11-02T09:00:00+01:00', value: 2 },
      { start: '2026-11-09T09:00:00+01:00', value: 3 },
    ]
    expect(foldWeek(buckets, 'Europe/Berlin')[0]?.[9]).toBe(5)
  })
})

function rangeOf(day: readonly [string, string, string, number, number]): [string, string] {
  return [day[1], day[2]]
}

describe('todayVsTypical', () => {
  const noon = (iso: string) => new Date(iso)

  it('means the other days and stops today at the current hour', () => {
    // Three days: two earlier at 4 each in hour 9, today at 9 in hour 9 and 1 in hour 10.
    const ctx = {
      from: '2026-11-02T00:00:00+01:00',
      to: '2026-11-05T00:00:00+01:00',
      tz: 'Europe/Berlin',
      now: noon('2026-11-04T09:30:00+01:00'),
    }
    const hours = todayVsTypical(
      [
        { start: '2026-11-02T09:00:00+01:00', value: 4 },
        { start: '2026-11-03T09:00:00+01:00', value: 4 },
        { start: '2026-11-04T09:00:00+01:00', value: 9 },
      ],
      ctx,
    )
    expect(hours).toHaveLength(24)
    expect(hours[9]).toEqual({ hour: 9, today: 9, typical: 4 })
    // Hour 8 has been reached with nothing in it: zero, not a gap. Hour 10 has not been reached.
    expect(hours[8]).toEqual({ hour: 8, today: 0, typical: 0 })
    expect(hours[10]).toEqual({ hour: 10, today: null, typical: 0 })
  })

  it('leaves the skipped hour out of the mean on a 23 hour day (Berlin)', () => {
    // 1 to 30 March: the 29th has no hour 2. 28 days, today is the 30th, so 27 others.
    const ctx = {
      from: '2026-03-03T00:00:00+01:00',
      to: '2026-03-31T00:00:00+02:00',
      tz: 'Europe/Berlin',
      now: noon('2026-03-30T12:00:00+02:00'),
    }
    const buckets = everyHour(ctx.from, ctx.to)
    const hours = todayVsTypical(buckets, ctx)
    // Each existing hour holds 1 on every day, so the mean is 1 whatever the divisor: the skipped
    // hour must not drag it to 26/27.
    expect(hours[2]?.typical).toBe(1)
    expect(hours[3]?.typical).toBe(1)
    // And a total over the other days divides by the days that have the hour: 26 for hour 2.
    const only = todayVsTypical([{ start: '2026-03-10T02:00:00+01:00', value: 26 }], ctx)
    expect(only[2]?.typical).toBe(1)
    expect(only[3]?.typical).toBe(0)
  })

  it('adds a repeated hour on a 25 hour day (New York)', () => {
    const ctx = {
      from: '2026-10-09T00:00:00-04:00',
      to: '2026-11-07T00:00:00-05:00',
      tz: 'America/New_York',
      now: noon('2026-11-06T12:00:00-05:00'),
    }
    // 1 November: both 1:00 hours, one on each offset, cost 3 each. 29 days in the window, 28 others.
    const hours = todayVsTypical(
      [
        { start: '2026-11-01T01:00:00-04:00', value: 3 },
        { start: '2026-11-01T01:00:00-05:00', value: 3 },
      ],
      ctx,
    )
    expect(hours[1]?.typical).toBeCloseTo(6 / 28)
  })

  it('has no typical value when the window holds no other day', () => {
    const ctx = {
      from: '2026-11-04T00:00:00+01:00',
      to: '2026-11-05T00:00:00+01:00',
      tz: 'Europe/Berlin',
      now: noon('2026-11-04T13:00:00Z'),
    }
    expect(todayVsTypical([], ctx).every((slot) => slot.typical === null)).toBe(true)
  })
})
