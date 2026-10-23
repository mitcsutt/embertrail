import type { Schemas } from '@mitcsutt/embertrail-client'

import type { BoardFilters, FilterOverride } from '#features/filters/types/filters'
import type { WidgetKind } from '#features/widgets/types/widget'

/** The configuration behind a Query Widget; its editor owns the details (#72 D10). */
export interface QueryWidgetConfig {
  source:
    | {
        kind: 'metric'
        name: string
        aggregation: 'sum' | 'avg' | 'min' | 'max' | 'count' | 'last'
      }
    | { kind: 'event'; name: string; aggregation: { fn: string; key?: string } }
  /** At most 3. */
  groupBy: string[]
  bucket?: 'minute' | 'hour' | 'day' | 'week' | 'month'
  filter: Schemas['Filter'][]
  chart: WidgetKind
  limit?: number
}

export type BoardItem =
  | { i: string; type: 'widget'; widget: string; override?: FilterOverride }
  | { i: string; type: 'query'; title: string; query: QueryWidgetConfig; override?: FilterOverride }
  /** A full-width heading, static in the Layout. */
  | { i: string; type: 'section'; title: string }

export interface BoardLayoutItem {
  i: string
  x: number
  y: number
  w: number
  h: number
  static?: boolean
}

/** A Board as stored in the `store` Module. */
export interface BoardDocument {
  schema_version: 1
  name: string
  filters: BoardFilters
  items: BoardItem[]
  /** 12 columns. */
  layout: BoardLayoutItem[]
}

/** The `store` namespace that holds Board documents. */
export const boardNamespace = 'embertrail-dashboard'

/** Preset ids. A stored Board id is never one of these. */
export const presetIds = ['overview', 'everything', 'new'] as const
