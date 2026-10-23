import { useNavigate, useSearch } from '@tanstack/react-router'
import { useCallback, useMemo, useState } from 'react'

import { filterSearchSchema } from '#features/filters/schemas/filterSearch'
import type { BoardFilters } from '#features/filters/types/filters'
import { browserTimeZone } from '#features/filters/utils/browserTimeZone'
import {
  clearedSearch,
  filtersFromSearch,
  searchFromFilters,
} from '#features/filters/utils/searchFilters'

export interface UseBoardFilters {
  /** The filters in force: the URL's, over the Board's saved ones. */
  filters: BoardFilters
  /** Changes the named filters; a key set to `undefined` clears that filter. */
  setFilters: (patch: Partial<BoardFilters>) => void
  /** Drops the URL's filters, back to the Board's saved ones. */
  reset: () => void
  /** True when the URL changes something the Board saved. */
  changed: boolean
  /** The browser's IANA zone. */
  tz: string
}

/**
 * The live filters of a Board, kept in the URL's search params so a view can be shared, and over
 * the Board's `saved` filters, which a bare URL shows. A change replaces the history entry rather
 * than adding one. Search params that are not filters are left as they are.
 */
export function useBoardFilters(saved: BoardFilters): UseBoardFilters {
  const search = useSearch({ strict: false })
  const navigate = useNavigate()

  const filters = useMemo(
    () => filtersFromSearch(filterSearchSchema.parse(search), saved),
    [search, saved],
  )
  const [tz] = useState(browserTimeZone)

  const write = useCallback(
    (next: FilterSearchPatch) => {
      void navigate({
        to: '.',
        replace: true,
        search: (previous: Record<string, unknown>) => ({ ...previous, ...clearedSearch, ...next }),
      })
    },
    [navigate],
  )

  const setFilters = useCallback(
    (patch: Partial<BoardFilters>) => {
      write(searchFromFilters({ ...filters, ...patch }, saved))
    },
    [filters, saved, write],
  )
  const reset = useCallback(() => {
    write({})
  }, [write])

  const written: Record<string, unknown> = searchFromFilters(filters, saved)
  const changed = Object.values(written).some((value) => value !== undefined)

  return { filters, setFilters, reset, changed, tz }
}

type FilterSearchPatch = ReturnType<typeof searchFromFilters>
