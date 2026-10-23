// @vitest-environment node

// The two Rhythm Widgets that fold time into local hours, "Today by hour vs typical" and "When you
// work", across clock changes (#42): Europe/Berlin and America/New_York, each on a Hub whose data
// spans the spring change (a 23 hour day) and on one whose data spans the autumn change (25 hours).
// Expected values come from the OTLP the dataset sent and `Intl`'s wall clock, not from the Hub.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { toQueryContext } from '#features/filters/utils/toQueryContext'
import { todayByHourVsTypical } from '#features/widgets/components/TodayByHourVsTypical'
import { whenYouWork } from '#features/widgets/components/WhenYouWork'

import { dashboardTestHub } from './hub.ts'
import type { DashboardTestHub } from './hub.ts'
import { add, pointsOf, wallClock } from './otlp.ts'
import { loadWidget } from './widget.ts'

const board = { time: { kind: 'relative', range: 'last-90-days' } } as const

/** Spring: Berlin changes on 29 March 2026 and New York on 8 March. */
const spring = new Date('2026-03-30T12:00:00Z')
/** Autumn: Berlin changes on 25 October 2026 and New York on 1 November. */
const autumn = new Date('2026-11-04T13:00:00Z')

const seasons = [
  { season: 'spring', now: spring },
  { season: 'autumn', now: autumn },
] as const
const zones = ['Europe/Berlin', 'America/New_York'] as const

const hubs = new Map<string, DashboardTestHub>()
beforeAll(async () => {
  for (const { season, now } of seasons) hubs.set(season, await dashboardTestHub({ now }))
})
afterAll(async () => {
  await Promise.all([...hubs.values()].map((hub) => hub.close()))
})

function hubOf(season: string) {
  const hub = hubs.get(season) ?? failed('hub')
  return { hub, demo: hub.demo ?? failed('demo') }
}

function failed(what: string): never {
  throw new Error(`${what} is missing`)
}

/** Which hour of a spring change day is skipped: 2, in both zones. */
const skipped = (season: string) => (season === 'spring' ? 2 : undefined)

describe.each(seasons)('on a Hub with data across the $season clock changes', ({ season, now }) => {
  describe.each(zones)('in %s', (tz) => {
    it('"When you work" folds active time into weekday and local hour', async () => {
      const { hub, demo } = hubOf(season)
      const ctx = toQueryContext(board, undefined, whenYouWork, now, tz)
      const data = await loadWidget(hub.client, whenYouWork, ctx)

      const expected = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0))
      let sent = 0
      for (const point of pointsOf(demo, 'claude_code.active_time.total')) {
        if (point.time < Date.parse(ctx.from) || point.time >= Date.parse(ctx.to)) continue
        const { weekday, hour } = wallClock(point.time, tz)
        const row = expected[weekday] ?? failed('weekday')
        row[hour] = (row[hour] ?? 0) + point.value
        sent += point.value
      }
      expect(sent).toBeGreaterThan(0)
      for (const [weekday, row] of expected.entries()) {
        for (const [hour, seconds] of row.entries()) {
          expect(
            data.cells[weekday]?.[hour],
            `weekday ${String(weekday)} hour ${String(hour)}`,
          ).toBeCloseTo(seconds, 4)
        }
      }
      expect(data.cells.flat().reduce((total, value) => total + value, 0)).toBeCloseTo(sent, 4)
    })

    it('"Today by hour vs typical" means the other days, per local hour that day has', async () => {
      const { hub, demo } = hubOf(season)
      const ctx = toQueryContext(board, undefined, todayByHourVsTypical, now, tz)
      const data = await loadWidget(hub.client, todayByHourVsTypical, ctx)

      // Cost per local day and hour, from the points.
      const totals = new Map<string, number>()
      for (const point of pointsOf(demo, 'claude_code.cost.usage')) {
        if (point.time < Date.parse(ctx.from) || point.time >= Date.parse(ctx.to)) continue
        const { day, hour } = wallClock(point.time, tz)
        add(totals, `${day}|${String(hour)}`, point.value)
      }
      const today = wallClock(now.getTime(), tz)
      const otherDays = new Set(
        [...totals.keys()].map((key) => key.split('|')[0] ?? '').filter((day) => day !== today.day),
      )
      expect(otherDays.size).toBeGreaterThan(20)

      expect(data.hours).toHaveLength(24)
      for (const [hour, slot] of data.hours.entries()) {
        let others = 0
        for (const day of otherDays) others += totals.get(`${day}|${String(hour)}`) ?? 0
        // The window holds 28 local days, 27 besides today; a skipped hour is missing from one.
        const days = 27 - (skipped(season) === hour ? 1 : 0)
        expect(slot.typical, `typical ${slot.hour}`).toBeCloseTo(others / days, 6)
      }
      // Today runs up to the current local hour and is blank after it.
      for (const [hour, slot] of data.hours.slice(0, today.hour + 1).entries()) {
        const mine = totals.get(`${today.day}|${String(hour)}`) ?? 0
        expect(slot.today, `today ${slot.hour}`).toBeCloseTo(mine, 6)
      }
      expect(data.hours.slice(today.hour + 1).every((slot) => slot.today === null)).toBe(true)
    })
  })
})

describe('the clock-change hour', () => {
  it('holds both occurrences of the repeated hour on Berlin’s 25 hour day', () => {
    const { demo } = hubOf('autumn')
    // The dataset starts a long Session just before its own zone's autumn change; it must have sent
    // cost in the repeated hour, or the fold above would pass without being tested. (New York's
    // repeated hour holds no data of this Berlin-paced dataset; the unit tests of `foldWeek` and
    // `todayVsTypical` cover it with synthetic buckets.)
    const costIn = (tz: string, day: string, hour: number) =>
      pointsOf(demo, 'claude_code.cost.usage')
        .filter((point) => {
          const at = wallClock(point.time, tz)
          return at.day === day && at.hour === hour
        })
        .reduce((total, point) => total + point.value, 0)
    expect(costIn('Europe/Berlin', '2026-10-25', 2)).toBeGreaterThan(0)
  })

  it('has no data in the skipped hour of the 23 hour day', () => {
    const { demo } = hubOf('spring')
    const sent = pointsOf(demo, 'claude_code.cost.usage')
    expect(sent.some((point) => wallClock(point.time, 'Europe/Berlin').day === '2026-03-29')).toBe(
      true,
    )
    expect(
      sent.filter((point) => {
        const at = wallClock(point.time, 'Europe/Berlin')
        return at.day === '2026-03-29' && at.hour === 2
      }),
    ).toEqual([])
  })
})
