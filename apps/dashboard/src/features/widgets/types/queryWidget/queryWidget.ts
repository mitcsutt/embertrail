import type { Schemas } from '@mitcsutt/embertrail-client'

import type { WidgetKind } from '#features/widgets/types/widget'

/** What a Query Widget asks for. A Board stores it in a `query` item; the editor builds it (#43). */
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

export type QueryBucket = NonNullable<QueryWidgetConfig['bucket']>

/** One thing wrong with a Query Widget's configuration; `field` names where the editor shows it. */
export interface QueryIssue {
  field: 'source' | 'aggregation' | 'groupBy' | 'bucket' | 'filter' | 'chart' | 'limit'
  message: string
}

/** A Query Widget's answer, shaped for its chart kind. */
export type QueryData = (
  | { chart: 'stat'; value: number | null }
  | { chart: 'series' | 'bars'; points: { x: string; series: string; value: number }[] }
  | { chart: 'bar-list' | 'share'; items: { label: string; value: number }[] }
  | { chart: 'table'; columns: string[]; rows: (string | number | boolean | null)[][] }
  /** Seconds-like values folded into Monday-first weekday × local hour cells. */
  | { chart: 'heatmap'; cells: number[][]; hasData: boolean }
) & {
  /** The Metric's unit, when the Hub names one. */
  unit: string | null
  /** The time bucket, which decides how a chart writes its x axis. */
  bucket?: QueryBucket
}
