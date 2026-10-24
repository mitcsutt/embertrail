import { useMemo } from 'react'

import type { BoardFilters, FilterOverride } from '#features/filters/types/filters'
import { useQueryContext } from '#features/filters/hooks/useQueryContext'
import { Widget } from '#features/widgets/components/Widget'
import { WidgetFrame } from '#features/widgets/components/WidgetFrame'
import type { QueryWidgetConfig } from '#features/widgets/types/queryWidget'
import { asCatalogueEntry } from '#features/widgets/utils/asCatalogueEntry'
import { queryWidgetDefinition } from '#features/widgets/utils/queryWidgetDefinition'
import { InvalidQueryError, validateQueryConfig } from '#features/widgets/utils/queryWidget'

export interface QueryWidgetProps {
  title: string
  config: QueryWidgetConfig
  override?: FilterOverride | undefined
  /** The filters in force on the Board. */
  filters: BoardFilters
  now: Date
  tz: string
  /** The title's heading level, from the Board's sections. */
  level?: 2 | 3
}

/** A Query Widget on a Board. A configuration the Query API would refuse shows why, in the frame. */
export function QueryWidget({
  title,
  config,
  override,
  filters,
  now,
  tz,
  level,
}: QueryWidgetProps) {
  const definition = useMemo(() => queryWidgetDefinition(title, config), [title, config])
  const ctx = useQueryContext(filters, override, definition, now, tz)
  const issues = useMemo(() => validateQueryConfig(config), [config])
  if (issues.length > 0) {
    return (
      <WidgetFrame title={title} level={level} status="error" error={new InvalidQueryError(issues)}>
        {null}
      </WidgetFrame>
    )
  }
  return <Widget definition={asCatalogueEntry(definition)} ctx={ctx} level={level} />
}
