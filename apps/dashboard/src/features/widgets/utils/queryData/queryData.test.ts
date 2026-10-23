import { describe, expect, it } from 'vitest'

import type { QueryWidgetConfig } from '#features/widgets/types/queryWidget'

import { isEmptyQueryData, selectQueryData } from './queryData'

const ctx = { tz: 'Europe/Berlin' }
const base: QueryWidgetConfig = {
  source: { kind: 'metric', name: 'claude_code.cost.usage', aggregation: 'sum' },
  groupBy: [],
  filter: [],
  chart: 'stat',
}

const answer = (
  rows: { group: Record<string, unknown>; value: number | null; bucket?: string }[],
  unit: string | null = 'USD',
) => ({ rows, meta: { tz: 'Europe/Berlin', unit } })

describe('selectQueryData', () => {
  it('reads a stat from the one row, and calls a missing row empty', () => {
    const data = selectQueryData(base, answer([{ group: {}, value: 4.5 }]), ctx)
    expect(data).toMatchObject({ chart: 'stat', value: 4.5, unit: 'USD' })
    const none = selectQueryData(base, answer([]), ctx)
    expect(isEmptyQueryData(none)).toBe(true)
  })

  it('names a series by its group values, joined, and the lack of a key Unknown', () => {
    const data = selectQueryData(
      { ...base, chart: 'series', bucket: 'day', groupBy: ['model', 'type'] },
      answer([
        { bucket: '2026-11-03T00:00:00+01:00', group: { model: 'opus', type: 'input' }, value: 1 },
        { bucket: '2026-11-03T00:00:00+01:00', group: { model: 'opus' }, value: 2 },
        { group: { model: 'dropped: no bucket' }, value: 9 },
        {
          bucket: '2026-11-04T00:00:00+01:00',
          group: { model: 'opus', type: 'input' },
          value: null,
        },
      ]),
      ctx,
    )
    expect(data).toMatchObject({
      chart: 'series',
      bucket: 'day',
      points: [
        { x: '2026-11-03T00:00:00+01:00', series: 'opus · input', value: 1 },
        { x: '2026-11-03T00:00:00+01:00', series: 'opus · Unknown', value: 2 },
      ],
    })
  })

  it('puts a limited bucketed query, which arrives newest first, back in time order', () => {
    const data = selectQueryData(
      { ...base, chart: 'series', bucket: 'hour', limit: 2 },
      answer([
        { bucket: '2026-03-29T03:00:00+02:00', group: {}, value: 3 },
        { bucket: '2026-03-29T01:00:00+01:00', group: {}, value: 1 },
      ]),
      ctx,
    )
    expect(data).toMatchObject({
      points: [
        { x: '2026-03-29T01:00:00+01:00', value: 1 },
        { x: '2026-03-29T03:00:00+02:00', value: 3 },
      ],
    })
  })

  it('puts the first key on the x axis for bars without a bucket, the rest in the series', () => {
    const data = selectQueryData(
      { ...base, chart: 'bars', groupBy: ['model', 'type'] },
      answer([{ group: { model: 'opus', type: 'input' }, value: 3 }]),
      ctx,
    )
    expect(data).toMatchObject({
      chart: 'bars',
      points: [{ x: 'opus', series: 'input', value: 3 }],
    })
    const single = selectQueryData(
      { ...base, chart: 'bars', groupBy: ['model'] },
      answer([{ group: { model: 'opus' }, value: 3 }]),
      ctx,
    )
    expect(single).toMatchObject({ points: [{ x: 'opus', series: 'Value', value: 3 }] })
  })

  it('lists and shares by the group label', () => {
    const data = selectQueryData(
      { ...base, chart: 'share', groupBy: ['model'] },
      answer([
        { group: { model: 'opus' }, value: 3 },
        { group: { model: null }, value: 1 },
      ]),
      ctx,
    )
    expect(data).toMatchObject({
      chart: 'share',
      items: [
        { label: 'opus', value: 3 },
        { label: 'Unknown', value: 1 },
      ],
    })
  })

  it('makes a table with a Time column only when there is a bucket, keeping empty values', () => {
    const data = selectQueryData(
      { ...base, chart: 'table', bucket: 'hour', groupBy: ['model'] },
      answer([{ bucket: '2026-11-03T10:00:00+01:00', group: { model: 'opus' }, value: null }]),
      ctx,
    )
    expect(data).toMatchObject({
      columns: ['Time', 'model', 'Value'],
      rows: [['2026-11-03T10:00:00+01:00', 'opus', null]],
    })
  })

  it('folds hourly rows into local weekday and hour cells in the zone', () => {
    // 22:30 UTC on Tuesday 3 November 2026 is 23:30 in Berlin, still Tuesday (index 1).
    const data = selectQueryData(
      { ...base, chart: 'heatmap', bucket: 'hour' },
      answer([{ bucket: '2026-11-03T22:00:00+00:00', group: {}, value: 5 }]),
      ctx,
    )
    expect(data.chart === 'heatmap' && data.cells[1]?.[23]).toBe(5)
    expect(isEmptyQueryData(data)).toBe(false)
  })
})
