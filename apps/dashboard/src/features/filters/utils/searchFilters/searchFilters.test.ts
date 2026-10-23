import { describe, expect, it } from 'vitest'

import { filterSearchSchema } from '#features/filters/schemas/filterSearch'
import type { BoardFilters } from '#features/filters/types/filters'

import { filtersFromSearch, searchFromFilters } from './searchFilters'

const saved: BoardFilters = { time: { kind: 'relative', range: 'last-7-days' } }
const pinned: BoardFilters = { ...saved, sourceId: 'src-1', model: 'claude-opus' }

describe('filterSearchSchema', () => {
  it('reads the filter keys and drops the rest', () => {
    expect(
      filterSearchSchema.parse({ range: 'today', source: 's', account: 'a', model: 'm', other: 1 }),
    ).toEqual({ range: 'today', source: 's', account: 'a', model: 'm' })
  })

  it('accepts an id the router parsed as a number', () => {
    expect(filterSearchSchema.parse({ source: 42 }).source).toBe('42')
  })

  it('drops a field that does not validate and keeps the others', () => {
    expect(
      filterSearchSchema.parse({
        range: 'next-year',
        from: '2026-02-30',
        to: '2026-03-01',
        model: 'm',
      }),
    ).toEqual({ model: 'm', to: '2026-03-01' })
  })
})

describe('filtersFromSearch', () => {
  const read = (search: unknown, from = saved) =>
    filtersFromSearch(filterSearchSchema.parse(search), from)

  it('shows the saved filters for a bare URL', () => {
    expect(read({})).toEqual(saved)
    expect(read({}, pinned)).toEqual(pinned)
  })

  it('lets the URL override the saved filters', () => {
    expect(read({ range: 'today', model: 'claude-haiku' }, pinned)).toEqual({
      time: { kind: 'relative', range: 'today' },
      sourceId: 'src-1',
      model: 'claude-haiku',
    })
  })

  it('reads a custom range', () => {
    expect(read({ range: 'custom', from: '2026-10-01', to: '2026-10-07' }).time).toEqual({
      kind: 'absolute',
      from: '2026-10-01',
      to: '2026-10-07',
    })
  })

  it.each([
    ['without its dates', { range: 'custom' }],
    ['with one date', { range: 'custom', from: '2026-10-01' }],
    ['ending before it starts', { range: 'custom', from: '2026-10-07', to: '2026-10-01' }],
  ])('falls back to the saved range for a custom range %s', (_name, search) => {
    expect(read(search).time).toEqual(saved.time)
  })

  it('reads an empty string as "all", clearing a saved pick', () => {
    expect(read({ source: '', model: '' }, pinned)).toEqual(saved)
  })
})

describe('searchFromFilters', () => {
  it('is empty when the filters are the saved ones', () => {
    expect(searchFromFilters(saved, saved)).toEqual({
      source: undefined,
      account: undefined,
      model: undefined,
    })
  })

  it.each<[string, BoardFilters, BoardFilters]>([
    ['a relative range', { time: { kind: 'relative', range: 'yesterday' } }, saved],
    ['a custom range', { time: { kind: 'absolute', from: '2026-10-01', to: '2026-10-07' } }, saved],
    ['picks over a bare Board', { ...saved, sourceId: 's', accountId: 'a', model: 'm' }, saved],
    ['all over saved picks', saved, pinned],
    ['a pick that differs from a saved one', { ...pinned, sourceId: 'src-2' }, pinned],
  ])('round-trips %s through the URL schema', (_name, filters, from) => {
    const search = searchFromFilters(filters, from)

    expect(filtersFromSearch(filterSearchSchema.parse(search), from)).toEqual(filters)
  })

  it('writes the empty string for a saved pick that is now "all"', () => {
    expect(searchFromFilters(saved, pinned)).toMatchObject({ source: '', model: '' })
  })
})
