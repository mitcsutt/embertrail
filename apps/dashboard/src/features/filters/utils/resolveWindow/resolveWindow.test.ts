import { describe, expect, it } from 'vitest'

import type { RelativeRange } from '#features/filters/types/filters'

import { absoluteRange, resolveFixedWindow, resolveWindow } from './resolveWindow'

const relative = (range: RelativeRange) => ({ kind: 'relative', range }) as const
const hours = ({ from, to }: { from: string; to: string }) =>
  (Date.parse(to) - Date.parse(from)) / 3_600_000

const ranges: RelativeRange[] = [
  'today',
  'yesterday',
  'this-week',
  'last-7-days',
  'last-30-days',
  'last-90-days',
]

// The four clock changes of 2026 in the two zones the Dashboard is tested in. `day` is the local
// date of the change; `length` is how long that local day lasts.
const transitions = [
  { tz: 'Europe/Berlin', day: '2026-03-29', length: 23, next: '2026-03-30' },
  { tz: 'Europe/Berlin', day: '2026-10-25', length: 25, next: '2026-10-26' },
  { tz: 'America/New_York', day: '2026-03-08', length: 23, next: '2026-03-09' },
  { tz: 'America/New_York', day: '2026-11-01', length: 25, next: '2026-11-02' },
] as const

// Midday local time of a date, safely inside the day in both zones.
const noon = (tz: string, date: string) =>
  new Date(`${date}T12:00:00${tz === 'Europe/Berlin' ? '+01:00' : '-05:00'}`)

describe('resolveWindow', () => {
  it('resolves every relative range in a plain zone', () => {
    // Wednesday 4 November 2026, 13:30 in Berlin.
    const now = new Date('2026-11-04T12:30:00Z')
    const bounds = (range: RelativeRange) => resolveWindow(relative(range), now, 'Europe/Berlin')

    expect(bounds('today')).toEqual({
      from: '2026-11-03T23:00:00.000Z',
      to: '2026-11-04T23:00:00.000Z',
    })
    expect(bounds('yesterday')).toEqual({
      from: '2026-11-02T23:00:00.000Z',
      to: '2026-11-03T23:00:00.000Z',
    })
    expect(bounds('this-week')).toEqual({
      from: '2026-11-01T23:00:00.000Z',
      to: '2026-11-04T23:00:00.000Z',
    })
    expect(bounds('last-7-days')).toEqual({
      from: '2026-10-28T23:00:00.000Z',
      to: '2026-11-04T23:00:00.000Z',
    })
    expect(bounds('last-30-days')).toEqual({
      from: '2026-10-05T22:00:00.000Z',
      to: '2026-11-04T23:00:00.000Z',
    })
    expect(bounds('last-90-days')).toEqual({
      from: '2026-08-06T22:00:00.000Z',
      to: '2026-11-04T23:00:00.000Z',
    })
  })

  it('reads the day in the zone, not in UTC', () => {
    // 23:30 UTC on the 4th is already the 5th in Berlin, and still the 4th in New York.
    const now = new Date('2026-11-04T23:30:00Z')

    expect(resolveWindow(relative('today'), now, 'Europe/Berlin').from).toBe(
      '2026-11-04T23:00:00.000Z',
    )
    expect(resolveWindow(relative('today'), now, 'America/New_York').from).toBe(
      '2026-11-04T05:00:00.000Z',
    )
  })

  it('starts the week on Monday, including on a Sunday and on the Monday itself', () => {
    const week = (now: string) =>
      resolveWindow(relative('this-week'), new Date(now), 'Europe/Berlin').from

    expect(week('2026-11-08T12:00:00Z')).toBe('2026-11-01T23:00:00.000Z') // Sunday 8th -> Monday 2nd
    expect(week('2026-11-02T12:00:00Z')).toBe('2026-11-01T23:00:00.000Z') // Monday 2nd
    expect(week('2026-11-01T12:00:00Z')).toBe('2026-10-25T23:00:00.000Z') // Sunday 1st -> Monday 26 Oct
  })

  describe.each(transitions)(
    'across the clock change on $day in $tz',
    ({ tz, day, length, next }) => {
      it(`makes that day ${String(length)} hours long`, () => {
        expect(hours(resolveWindow(relative('today'), noon(tz, day), tz))).toBe(length)
      })

      it('counts yesterday on the day after as the long or short day', () => {
        expect(hours(resolveWindow(relative('yesterday'), noon(tz, next), tz))).toBe(length)
      })

      it('keeps days whole in every range that spans it', () => {
        const now = noon(tz, next)
        for (const range of ranges) {
          const { from, to } = resolveWindow(relative(range), now, tz)
          // Every boundary is local midnight, so the window is whole days.
          for (const instant of [from, to]) {
            const clock = new Intl.DateTimeFormat('en-GB', {
              timeZone: tz,
              hour: '2-digit',
              minute: '2-digit',
              hourCycle: 'h23',
            }).format(new Date(instant))
            expect(clock, `${range} ${instant}`).toBe('00:00')
          }
        }
        // A week containing the change is a day longer or shorter than 7 x 24 hours.
        const week = resolveWindow(relative('last-7-days'), now, tz)
        expect(hours(week)).toBe(7 * 24 + (length - 24))
      })

      it('resolves "today" on the day itself to the whole local day', () => {
        const { from, to } = resolveWindow(relative('today'), noon(tz, day), tz)
        expect(new Date(from).getTime() < noon(tz, day).getTime()).toBe(true)
        expect(new Date(to).getTime() > noon(tz, day).getTime()).toBe(true)
      })
    },
  )

  describe('an absolute range', () => {
    it('runs from the first day to the end of the last, in the zone', () => {
      expect(
        resolveWindow(
          { kind: 'absolute', from: '2026-10-24', to: '2026-10-26' },
          new Date(),
          'Europe/Berlin',
        ),
      ).toEqual({ from: '2026-10-23T22:00:00.000Z', to: '2026-10-26T23:00:00.000Z' })
    })

    it('can be a single day', () => {
      const day = resolveWindow(
        { kind: 'absolute', from: '2026-10-25', to: '2026-10-25' },
        new Date(),
        'Europe/Berlin',
      )
      expect(hours(day)).toBe(25)
    })

    it.each([
      ['not a date', { from: 'yesterday', to: '2026-10-26' }],
      ['a date that does not exist', { from: '2026-02-30', to: '2026-03-02' }],
      ['an end before the start', { from: '2026-10-26', to: '2026-10-25' }],
    ])('refuses %s', (_name, range) => {
      expect(() =>
        resolveWindow({ kind: 'absolute', ...range }, new Date(), 'Europe/Berlin'),
      ).toThrow(RangeError)
    })
  })

  it('refuses a zone that does not exist', () => {
    expect(() => resolveWindow(relative('today'), new Date(), 'Mars/Olympus')).toThrow(RangeError)
  })
})

describe('resolveFixedWindow', () => {
  const now = new Date('2026-11-04T12:30:00Z')

  it('matches the relative ranges for today and this week', () => {
    expect(resolveFixedWindow('today', now, 'Europe/Berlin')).toEqual(
      resolveWindow(relative('today'), now, 'Europe/Berlin'),
    )
    expect(resolveFixedWindow('this-week', now, 'Europe/Berlin')).toEqual(
      resolveWindow(relative('this-week'), now, 'Europe/Berlin'),
    )
  })

  it('reads the last 28 days including today', () => {
    expect(resolveFixedWindow('last-28-days', now, 'Europe/Berlin')).toEqual({
      from: '2026-10-07T22:00:00.000Z',
      to: '2026-11-04T23:00:00.000Z',
    })
  })

  it('reads 12 weeks from the Monday 11 weeks back, through today', () => {
    // Monday 2 November minus 77 days is Monday 17 August; Berlin is on summer time then.
    expect(resolveFixedWindow('last-12-weeks', now, 'Europe/Berlin')).toEqual({
      from: '2026-08-16T22:00:00.000Z',
      to: '2026-11-04T23:00:00.000Z',
    })
  })
})

describe('absoluteRange', () => {
  const now = new Date('2026-10-26T12:00:00Z')

  it('turns a relative range into the dates it covers, inclusive', () => {
    expect(absoluteRange(relative('last-7-days'), now, 'Europe/Berlin')).toEqual({
      kind: 'absolute',
      from: '2026-10-20',
      to: '2026-10-26',
    })
    expect(absoluteRange(relative('yesterday'), now, 'Europe/Berlin')).toEqual({
      kind: 'absolute',
      from: '2026-10-25',
      to: '2026-10-25',
    })
  })

  it('round-trips through resolveWindow, across a clock change', () => {
    for (const range of ranges) {
      const custom = absoluteRange(relative(range), now, 'Europe/Berlin')
      expect(resolveWindow(custom, now, 'Europe/Berlin'), range).toEqual(
        resolveWindow(relative(range), now, 'Europe/Berlin'),
      )
    }
  })

  it('returns an absolute range as it is', () => {
    const custom = { kind: 'absolute', from: '2026-01-01', to: '2026-01-31' } as const
    expect(absoluteRange(custom, now, 'Europe/Berlin')).toBe(custom)
  })
})
