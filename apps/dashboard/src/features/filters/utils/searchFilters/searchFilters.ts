import type { BoardFilters, TimeRange } from '#features/filters/types/filters'
import type { FilterSearch } from '#features/filters/schemas/filterSearch'

/** The search keys the filters own, all unset: spread it to clear them from a URL. */
export const clearedSearch: Record<keyof FilterSearch, undefined> = {
  range: undefined,
  from: undefined,
  to: undefined,
  source: undefined,
  account: undefined,
  model: undefined,
}

function timeFromSearch(search: FilterSearch): TimeRange | undefined {
  if (search.range === undefined) return undefined
  if (search.range !== 'custom') return { kind: 'relative', range: search.range }
  if (search.from === undefined || search.to === undefined || search.from > search.to) {
    return undefined
  }
  return { kind: 'absolute', from: search.from, to: search.to }
}

// '' is "all", for a Board whose saved filters pick one; otherwise a missing key follows the Board.
function pick(value: string | undefined, saved: string | undefined): string | undefined {
  if (value === undefined) return saved
  return value === '' ? undefined : value
}

/**
 * The filters a Board shows: what the URL sets, over the Board's saved filters. A URL that sets
 * nothing, or only things that do not validate, shows the saved filters.
 */
export function filtersFromSearch(search: FilterSearch, saved: BoardFilters): BoardFilters {
  const filters: BoardFilters = { time: timeFromSearch(search) ?? saved.time }
  const sourceId = pick(search.source, saved.sourceId)
  const accountId = pick(search.account, saved.accountId)
  const model = pick(search.model, saved.model)
  if (sourceId !== undefined) filters.sourceId = sourceId
  if (accountId !== undefined) filters.accountId = accountId
  if (model !== undefined) filters.model = model
  return filters
}

function sameTime(a: TimeRange, b: TimeRange): boolean {
  if (a.kind === 'relative') return b.kind === 'relative' && a.range === b.range
  return b.kind === 'absolute' && a.from === b.from && a.to === b.to
}

// Writes a value only where it differs from the saved one, so a Board's URL stays bare until
// someone changes a filter. A saved value that is now unset is written as '' ("all").
function omit(value: string | undefined, saved: string | undefined): string | undefined {
  if (value === saved) return undefined
  return value ?? ''
}

/** The inverse of {@link filtersFromSearch}: the search that shows `filters` over `saved`. */
export function searchFromFilters(filters: BoardFilters, saved: BoardFilters): FilterSearch {
  const search: FilterSearch = {
    source: omit(filters.sourceId, saved.sourceId),
    account: omit(filters.accountId, saved.accountId),
    model: omit(filters.model, saved.model),
  }
  if (!sameTime(filters.time, saved.time)) {
    if (filters.time.kind === 'relative') {
      search.range = filters.time.range
    } else {
      search.range = 'custom'
      search.from = filters.time.from
      search.to = filters.time.to
    }
  }
  return search
}
