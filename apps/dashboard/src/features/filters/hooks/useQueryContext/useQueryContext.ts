import { useMemo } from 'react'

import type { BoardFilters, FilterOverride, QueryContext } from '#features/filters/types/filters'
import { toQueryContext } from '#features/filters/utils/toQueryContext'
import type { WidgetScope } from '#features/filters/utils/toQueryContext'

/** `toQueryContext`, kept while its inputs are: the context a Widget's request is built from. */
export function useQueryContext(
  filters: BoardFilters,
  override: FilterOverride | undefined,
  widget: WidgetScope,
  now: Date,
  tz: string,
): QueryContext {
  return useMemo(
    () => toQueryContext(filters, override, widget, now, tz),
    [filters, override, widget, now, tz],
  )
}
