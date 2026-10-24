import { describe, expect, it } from 'vitest'

import type { QueryContext } from '#features/filters/types/filters'

import { periodComparison, periodDelta, periodHint, periodStat, selectPeriod } from './PeriodStat'
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
/** The answer to a KPI's two queries: the window by bucket, and the window before as one total. */
const answer = (window: [string, number][], before: number | null) => [
  rows(window),
  { rows: before === null ? [] : [{ value: before, group: {} }] },
]

const spec = {
  id: 'period-test',
  group: 'spend' as const,
  title: 'Cost',
  description: 'Cost',
  metric: 'claude_code.cost.usage',
  filters: [] as const,
  format: String,
}
const queries = (ctx: Pick<QueryContext, 'from' | 'to' | 'tz' | 'now'>) => {
  const request = periodStat(spec).request({
    ...ctx,
    filter: [],
    sessions: {},
  })
  if (request.op !== 'queryMetricsEach') throw new Error('expected two queries')
  return request.bodies
}

const data = (total: number | null, previous: number | null): PeriodStatData => ({
  total,
  previous,
  days: 7,
  running: false,
  points: [],
  bucket: 'day',
})

describe('selectPeriod', () => {
  it('reads the window and the total of the 7 days before it', () => {
    const selected = selectPeriod(
      answer(
        [
          [day('2026-10-29'), 2],
          [day('2026-11-04'), 3],
        ],
        5,
      ),
      week,
    )
    expect(selected.total).toBe(5)
    expect(selected.previous).toBe(5)
    expect(selected.days).toBe(7)
    expect(selected.bucket).toBe('day')
    expect(selected.running).toBe(false)
  })

  it('draws every day of the window, a quiet one as zero', () => {
    const { points } = selectPeriod(
      answer(
        [
          [day('2026-10-29'), 2],
          [day('2026-11-04'), 3],
        ],
        null,
      ),
      week,
    )
    expect(points.map(({ value }) => value)).toEqual([2, 0, 0, 0, 0, 0, 3])
  })

  it('is empty when neither window holds the Metric, and zero when only the one before does', () => {
    expect(selectPeriod(answer([], null), week).total).toBeNull()
    const quiet = selectPeriod(answer([], 4), week)
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
    const selected = selectPeriod(answer([['2026-11-04T09:00:00+01:00', 2]], 1), today)
    expect(selected.bucket).toBe('hour')
    expect(selected.points).toHaveLength(24)
    expect(selected.total).toBe(2)
    expect(selected.previous).toBe(1)
  })
})

describe('a window that is still running', () => {
  const today = {
    from: '2026-11-04T00:00:00.000+01:00',
    to: '2026-11-05T00:00:00.000+01:00',
    tz,
    now: new Date('2026-11-04T09:30:00+01:00'),
  }
  const monday = {
    from: '2026-10-27T00:00:00.000+01:00',
    to: '2026-11-03T00:00:00.000+01:00',
    tz,
    now: new Date('2026-11-02T04:00:00+01:00'),
  }

  it('asks for today up to now and yesterday up to exactly the same time', () => {
    const [window, before] = queries(today)
    expect(Date.parse(window?.from ?? '')).toBe(Date.parse(today.from))
    expect(Date.parse(window?.to ?? '')).toBe(today.now.getTime())
    expect(window?.bucket).toBe('hour')
    expect(Date.parse(before?.from ?? '')).toBe(Date.parse('2026-11-03T00:00:00+01:00'))
    expect(Date.parse(before?.to ?? '')).toBe(Date.parse('2026-11-03T09:30:00+01:00'))
    expect(before?.bucket).toBeUndefined()
  })

  it('stops the sparkline at now and says what the comparison covers', () => {
    const selected = selectPeriod(answer([['2026-11-04T08:00:00+01:00', 4]], 3), today)
    expect(selected.total).toBe(4)
    expect(selected.previous).toBe(3)
    expect(selected.running).toBe(true)
    expect(selected.points).toHaveLength(10)
    expect(Date.parse(selected.points.at(-1)?.at ?? '')).toBeLessThan(today.now.getTime())
    expect(periodComparison(selected, String)).toBe('Against 3 by this time the day before')
  })

  it('compares the last 7 days on a Monday morning up to the same hour, a day at a time', () => {
    const [window, before] = queries(monday)
    expect(window?.bucket).toBe('day')
    expect(Date.parse(window?.to ?? '')).toBe(monday.now.getTime())
    expect(Date.parse(before?.from ?? '')).toBe(Date.parse('2026-10-20T00:00:00+02:00'))
    expect(Date.parse(before?.to ?? '')).toBe(Date.parse('2026-10-26T04:00:00+01:00'))

    const selected = selectPeriod(
      answer(
        [
          [day('2026-10-27'), 5],
          [day('2026-11-02'), 2],
        ],
        3,
      ),
      monday,
    )
    expect(selected.points.map(({ value }) => value)).toEqual([5, 0, 0, 0, 0, 0, 2])
    expect(Date.parse(selected.points.at(-1)?.at ?? '')).toBeLessThan(monday.now.getTime())
    expect(periodComparison(selected, String)).toBe('Against 3 by this time in the 7 days before')
  })

  it('asks for days, not hours, over a long custom range that ends after now', () => {
    const [window, before] = queries({
      from: '2025-01-01T00:00:00.000+01:00',
      to: '2027-01-01T00:00:00.000+01:00',
      tz,
      now: new Date('2026-10-24T12:00:00Z'),
    })
    expect(window?.bucket).toBe('day')
    expect(before?.bucket).toBeUndefined()
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
