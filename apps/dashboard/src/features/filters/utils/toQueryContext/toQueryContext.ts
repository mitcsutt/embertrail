import type { Schemas } from '@mitcsutt/embertrail-client'

import type { BoardFilters, FilterOverride, QueryContext } from '#features/filters/types/filters'
import type { FixedWindow } from '#features/filters/types/window'
import { resolveFixedWindow, resolveWindow } from '#features/filters/utils/resolveWindow'

/**
 * What the context needs to know about a Widget. A `WidgetDefinition` satisfies it; the filters
 * feature cannot import the widgets feature, so it asks for the two fields it reads.
 */
export interface WidgetScope {
  /** `board` follows the Board's time range; the rest are fixed windows that ignore it. */
  window: 'board' | FixedWindow
  /** The Board filters this Widget honours. The others are left out of its request. */
  filters: readonly ('source' | 'account' | 'model')[]
}

/** A Widget's own pinned filters win over the Board's; a field it leaves unset follows the Board. */
export function effectiveFilters(filters: BoardFilters, override?: FilterOverride): BoardFilters {
  const effective: BoardFilters = { time: override?.time ?? filters.time }
  const sourceId = override?.sourceId ?? filters.sourceId
  const accountId = override?.accountId ?? filters.accountId
  const model = override?.model ?? filters.model
  if (sourceId !== undefined) effective.sourceId = sourceId
  if (accountId !== undefined) effective.accountId = accountId
  if (model !== undefined) effective.model = model
  return effective
}

/**
 * Builds what one Widget's request is made from: its window (the Board's range, or its own fixed
 * one), the zone, and the Query API filters for the Board filters it honours, after its pinned
 * overrides are applied.
 */
export function toQueryContext(
  filters: BoardFilters,
  override: FilterOverride | undefined,
  widget: WidgetScope,
  now: Date,
  tz: string,
): QueryContext {
  const effective = effectiveFilters(filters, override)
  const { from, to } =
    widget.window === 'board'
      ? resolveWindow(effective.time, now, tz)
      : resolveFixedWindow(widget.window, now, tz)

  const filter: Schemas['Filter'][] = []
  const sessions: QueryContext['sessions'] = {}
  if (effective.sourceId !== undefined && widget.filters.includes('source')) {
    filter.push({ key: 'embertrail.source_id', op: 'eq', value: effective.sourceId })
    sessions.source_id = effective.sourceId
  }
  if (effective.accountId !== undefined && widget.filters.includes('account')) {
    filter.push({ key: 'embertrail.account_id', op: 'eq', value: effective.accountId })
    sessions.account_id = effective.accountId
  }
  if (effective.model !== undefined && widget.filters.includes('model')) {
    filter.push({ key: 'model', op: 'eq', value: effective.model })
    sessions.model = effective.model
  }

  return { from, to, tz, filter, now, sessions }
}
