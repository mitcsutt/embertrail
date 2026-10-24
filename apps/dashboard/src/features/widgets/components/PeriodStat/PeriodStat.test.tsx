import { describe, expect, it } from 'vitest'

import { periodComparison, periodDelta, periodHint, selectPeriod } from './PeriodStat'
import type { PeriodStatData } from './PeriodStat'

const tz = 'Europe/Berlin'
/** The last 7 days on 4 November 2026 in Berlin, as `resolveWindow` gives them. */
const ended = new Date('2030-01-01T00:00:00Z')
const week = {
  from: '2026-10-29T00:00:00.000+01:00',
  to: '2026-11-05T00:00:00.000+01:00',
  tz,
  now: ended,
}

/** A day bucket's start as the Hub writes it: local midnight with the zone's offset. */
const day = (date: string) => `${date}T00:00:00+01:00`
const rows = (values: [string, number][]) => ({
  rows: values.map(([bucket, value]) => ({ bucket, value, group: {} })),
})

const data = (total: number | null, previous: number | null): PeriodStatData => ({
  total,
  previous,
  days: 7,
  points: [],
  bucket: 'day',
})

describe('selectPeriod', () => {
  it('splits the answer into the window and the 7 days before it', () => {
    const selected = selectPeriod(
      rows([
        [day('2026-10-26'), 4],
        [day('2026-10-28'), 1],
        [day('2026-10-29'), 2],
        [day('2026-11-04'), 3],
      ]),
      week,
    )
    expect(selected.total).toBe(5)
    expect(selected.previous).toBe(5)
    expect(selected.days).toBe(7)
    expect(selected.bucket).toBe('day')
  })

  it('draws every day of the window, a quiet one as zero', () => {
    const { points } = selectPeriod(
      rows([
        [day('2026-10-29'), 2],
        [day('2026-11-04'), 3],
      ]),
      week,
    )
    expect(points.map(({ value }) => value)).toEqual([2, 0, 0, 0, 0, 0, 3])
    expect(points.map(({ at }) => Date.parse(at))).toEqual(
      [29, 30, 31, 1, 2, 3, 4].map((date, index) =>
        Date.parse(
          `2026-${index < 3 ? '10' : '11'}-${String(date).padStart(2, '0')}T00:00:00+01:00`,
        ),
      ),
    )
  })

  it('is empty when neither window holds the Metric, and zero when only the one before does', () => {
    expect(selectPeriod(rows([]), week).total).toBeNull()
    const quiet = selectPeriod(rows([[day('2026-10-28'), 4]]), week)
    expect(quiet.total).toBe(0)
    expect(quiet.previous).toBe(4)
  })

  it('reads today by the hour', () => {
    const today = {
      from: '2026-11-04T00:00:00.000+01:00',
      to: '2026-11-05T00:00:00.000+01:00',
      tz,
      now: ended,
    }
    const selected = selectPeriod(
      rows([
        ['2026-11-03T10:00:00+01:00', 1],
        ['2026-11-04T09:00:00+01:00', 2],
      ]),
      today,
    )
    expect(selected.bucket).toBe('hour')
    expect(selected.points).toHaveLength(24)
    expect(selected.total).toBe(2)
    expect(selected.previous).toBe(1)
  })
})

describe('a window that is still running', () => {
  it('compares today at 09:00 with yesterday up to 09:00 and stops the sparkline at now', () => {
    const today = {
      from: '2026-11-04T00:00:00.000+01:00',
      to: '2026-11-05T00:00:00.000+01:00',
      tz,
      now: new Date('2026-11-04T09:00:00+01:00'),
    }
    const selected = selectPeriod(
      rows([
        ['2026-11-03T08:00:00+01:00', 3],
        ['2026-11-03T09:00:00+01:00', 10],
        ['2026-11-03T15:00:00+01:00', 7],
        ['2026-11-04T08:00:00+01:00', 4],
      ]),
      today,
    )
    expect(selected.total).toBe(4)
    expect(selected.previous).toBe(3)
    expect(selected.points).toHaveLength(9)
    expect(Date.parse(selected.points.at(-1)?.at ?? '')).toBeLessThan(today.now.getTime())
  })

  it('compares the last 7 days on a Monday morning up to the same hour, a day at a time', () => {
    const monday = {
      from: '2026-10-27T00:00:00.000+01:00',
      to: '2026-11-03T00:00:00.000+01:00',
      tz,
      now: new Date('2026-11-02T04:00:00+01:00'),
    }
    const selected = selectPeriod(
      rows([
        ['2026-10-25T10:00:00+01:00', 2],
        ['2026-10-26T01:00:00+01:00', 1],
        ['2026-10-26T10:00:00+01:00', 50],
        ['2026-10-27T12:00:00+01:00', 5],
        ['2026-11-02T03:00:00+01:00', 2],
      ]),
      monday,
    )
    expect(selected.bucket).toBe('day')
    expect(selected.total).toBe(7)
    expect(selected.previous).toBe(3)
    expect(selected.points.map(({ value }) => value)).toEqual([5, 0, 0, 0, 0, 0, 2])
    expect(Date.parse(selected.points.at(-1)?.at ?? '')).toBeLessThan(monday.now.getTime())
  })
})

describe('periodDelta', () => {
  it('is the change against the window before, as a signed percentage', () => {
    expect(periodDelta(data(12, 10))).toEqual({ value: '+20%', direction: 'up', tone: 'neutral' })
    expect(periodDelta(data(5, 10))).toEqual({ value: '−50%', direction: 'down', tone: 'neutral' })
    expect(periodDelta(data(10, 10))).toEqual({ value: '0%', direction: 'flat', tone: 'neutral' })
  })

  it('says nothing when there is nothing to compare with', () => {
    expect(periodDelta(data(5, null))).toBeUndefined()
    expect(periodDelta(data(5, 0))).toBeUndefined()
    expect(periodDelta(data(null, null))).toBeUndefined()
  })
})

describe('the hint', () => {
  const format = (value: number) => `$${String(value)}`

  it('names the figure it is compared with, and the period in full', () => {
    expect(periodHint(data(12, 10), format)).toBe('vs $10')
    expect(periodComparison(data(12, 10), format)).toBe('Against $10 in the 7 days before')
    expect(periodComparison({ ...data(12, 10), days: 1 }, format)).toBe(
      'Against $10 in the day before',
    )
  })

  it('says when the window before holds nothing', () => {
    expect(periodHint(data(12, null), format)).toBe('Nothing before')
    expect(periodComparison(data(12, null), format)).toBe('Nothing in the 7 days before')
  })
})
