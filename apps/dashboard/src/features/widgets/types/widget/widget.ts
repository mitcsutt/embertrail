import type { OperationInput } from '@mitcsutt/embertrail-client'
import type { ChartStatus } from '@mitcsutt/kiln-charts'
import type { ReactNode } from 'react'

import type { Inventory } from '#features/filters/data/inventory'
import type { QueryContext } from '#features/filters/types/filters'
import type { FixedWindow } from '#features/filters/types/window'

export type WidgetKind = 'stat' | 'series' | 'bars' | 'bar-list' | 'share' | 'table' | 'heatmap'

export type WidgetGroup =
  'spend' | 'sessions' | 'models' | 'tools' | 'output' | 'rhythm' | 'reliability'

/** `board` follows the Board's time range; the rest are fixed windows that ignore it. */
export type WidgetWindow = 'board' | FixedWindow

export type WidgetRequest =
  | { op: 'queryMetrics'; body: OperationInput<'queryMetrics'>['body'] }
  | { op: 'queryMetricsEach'; bodies: OperationInput<'queryMetrics'>['body'][] }
  | { op: 'queryEvents'; body: OperationInput<'queryEvents'>['body'] }
  | { op: 'listSessions'; query: OperationInput<'listSessions'>['query'] }

/** One entry in the Catalogue. */
export interface WidgetDefinition<Data = unknown> {
  /** Stable and kebab-case, such as `cost-today`. Board documents store it. */
  id: string
  group: WidgetGroup
  title: string
  description?: string
  kind: WidgetKind
  size: { w: number; h: number }
  minSize?: { w: number; h: number }
  window: WidgetWindow
  /** The Board filters this Widget honours. Filtering `session.count` by model would empty it. */
  filters: readonly ('source' | 'account' | 'model')[]
  /** The View names things by the Inventory (an Account by its label): it is fetched and passed in. */
  inventory?: boolean
  request(ctx: QueryContext): WidgetRequest
  select(response: unknown, ctx: QueryContext): Data
  isEmpty(data: Data): boolean
  View: (props: {
    data: Data
    ctx: QueryContext
    status: ChartStatus
    label: string
    /** The window's Inventory; set when the definition asks for it and the Hub has answered. */
    inventory?: Inventory
  }) => ReactNode
}
