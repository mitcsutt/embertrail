import { describe, expect, it } from 'vitest'

import type { BoardFilters } from '#features/filters/types/filters'

import { effectiveFilters, toQueryContext } from './toQueryContext'
import type { WidgetScope } from './toQueryContext'

const now = new Date('2026-11-04T12:30:00Z')
const tz = 'Europe/Berlin'
const all = ['source', 'account', 'model'] as const
const board: WidgetScope = { window: 'board', filters: all }

const filters: BoardFilters = {
  time: { kind: 'relative', range: 'last-7-days' },
  sourceId: 'src-1',
  accountId: 'acc-1',
  model: 'claude-opus',
}

describe('toQueryContext', () => {
  it('resolves the Board range and maps every filter the Widget honours', () => {
    expect(toQueryContext(filters, undefined, board, now, tz)).toEqual({
      from: '2026-10-28T23:00:00.000Z',
      to: '2026-11-04T23:00:00.000Z',
      tz,
      now,
      filter: [
        { key: 'embertrail.source_id', op: 'eq', value: 'src-1' },
        { key: 'embertrail.account_id', op: 'eq', value: 'acc-1' },
        { key: 'model', op: 'eq', value: 'claude-opus' },
      ],
      sessions: { source_id: 'src-1', account_id: 'acc-1', model: 'claude-opus' },
    })
  })

  it('sends no filter for a Board with none set', () => {
    const context = toQueryContext({ time: filters.time }, undefined, board, now, tz)

    expect(context.filter).toEqual([])
    expect(context.sessions).toEqual({})
  })

  it('leaves out a filter the Widget does not honour, in both shapes', () => {
    // session.count has no `model` attribute: filtering by it would show nothing.
    const context = toQueryContext(
      filters,
      undefined,
      { window: 'board', filters: ['source'] },
      now,
      tz,
    )

    expect(context.filter).toEqual([{ key: 'embertrail.source_id', op: 'eq', value: 'src-1' }])
    expect(context.sessions).toEqual({ source_id: 'src-1' })
  })

  it('uses a fixed window and ignores the Board range, even a pinned one', () => {
    const today: WidgetScope = { window: 'today', filters: all }
    const pinned = { time: { kind: 'relative', range: 'last-90-days' } } as const

    const fixed = toQueryContext(filters, pinned, today, now, tz)

    expect(fixed.from).toBe('2026-11-03T23:00:00.000Z')
    expect(fixed.to).toBe('2026-11-04T23:00:00.000Z')
    expect(fixed.filter).toHaveLength(3)
  })

  it('applies a pinned override over the Board', () => {
    const context = toQueryContext(
      filters,
      { time: { kind: 'relative', range: 'yesterday' }, model: 'claude-haiku' },
      board,
      now,
      tz,
    )

    expect(context.from).toBe('2026-11-02T23:00:00.000Z')
    expect(context.to).toBe('2026-11-03T23:00:00.000Z')
    expect(context.filter).toContainEqual({ key: 'model', op: 'eq', value: 'claude-haiku' })
    expect(context.filter).toContainEqual({ key: 'embertrail.source_id', op: 'eq', value: 'src-1' })
  })

  it('keeps the pinned fields when the Board filters change', () => {
    const pinned = { sourceId: 'src-pinned', time: { kind: 'relative', range: 'today' } } as const
    const before = toQueryContext(filters, pinned, board, now, tz)

    const changed: BoardFilters = {
      time: { kind: 'relative', range: 'last-30-days' },
      sourceId: 'src-2',
      accountId: 'acc-2',
      model: 'claude-sonnet',
    }
    const after = toQueryContext(changed, pinned, board, now, tz)

    // The pinned range and Source are the same request as before ...
    expect([after.from, after.to]).toEqual([before.from, before.to])
    expect(after.filter[0]).toEqual({ key: 'embertrail.source_id', op: 'eq', value: 'src-pinned' })
    expect(after.sessions.source_id).toBe('src-pinned')
    // ... and the fields it did not pin follow the Board.
    expect(after.sessions).toEqual({
      source_id: 'src-pinned',
      account_id: 'acc-2',
      model: 'claude-sonnet',
    })
  })

  it('gives a Widget with every field pinned the same request whatever the Board does', () => {
    const pinned = {
      time: { kind: 'absolute', from: '2026-10-01', to: '2026-10-07' },
      sourceId: 's',
      accountId: 'a',
      model: 'm',
    } as const

    const one = toQueryContext(filters, pinned, board, now, tz)
    const two = toQueryContext(
      { time: { kind: 'relative', range: 'today' } },
      pinned,
      board,
      now,
      tz,
    )

    expect(two).toEqual(one)
  })
})

describe('effectiveFilters', () => {
  it('ignores an override field that is undefined', () => {
    expect(effectiveFilters(filters, { sourceId: undefined, model: 'm' })).toEqual({
      ...filters,
      model: 'm',
    })
  })

  it('returns the Board filters without an override', () => {
    expect(effectiveFilters(filters)).toEqual(filters)
  })
})
