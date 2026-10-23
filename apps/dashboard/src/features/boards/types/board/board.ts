import type { BoardFilters, FilterOverride } from '#features/filters/types/filters'
import type { QueryWidgetConfig } from '#features/widgets/types/queryWidget'

export type { QueryWidgetConfig }

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
