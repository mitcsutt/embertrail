import { describe, expect, it } from 'vitest'

import { makeFilter, newQueryConfig, withDrawableChart } from './queryDraft'

describe('makeFilter', () => {
  it('reads a number or true and false as such, and anything else as text', () => {
    expect(makeFilter('status_code', 'eq', '529')).toEqual({
      key: 'status_code',
      op: 'eq',
      value: 529,
    })
    expect(makeFilter('success', 'eq', 'false')).toEqual({ key: 'success', op: 'eq', value: false })
    expect(makeFilter('tool_name', 'eq', 'Edit')).toEqual({
      key: 'tool_name',
      op: 'eq',
      value: 'Edit',
    })
  })

  it('splits the members of in and not_in on commas', () => {
    expect(makeFilter('model', 'in', 'opus, sonnet, ')).toEqual({
      key: 'model',
      op: 'in',
      value: ['opus', 'sonnet'],
    })
  })

  it('gives presence operators no value', () => {
    expect(makeFilter('model', 'exists', 'ignored')).toEqual({ key: 'model', op: 'exists' })
  })
})

describe('withDrawableChart', () => {
  it('leaves a chart that can draw the rows alone', () => {
    const config = { ...newQueryConfig(), chart: 'table' as const, bucket: 'day' as const }
    expect(withDrawableChart(config)).toBe(config)
  })

  it('moves a chart that lost its rows to the first one that fits', () => {
    expect(withDrawableChart({ ...newQueryConfig(), bucket: 'day' }).chart).toBe('series')
    expect(withDrawableChart({ ...newQueryConfig(), groupBy: ['model'] }).chart).toBe('bars')
    expect(
      withDrawableChart({ ...newQueryConfig(), chart: 'heatmap', bucket: 'day', groupBy: ['a'] })
        .chart,
    ).toBe('series')
  })
})
