import type { OperationOutput } from '@mitcsutt/embertrail-client'

import type { QueryContext } from '#features/filters/types/filters'
import type { QueryData, QueryWidgetConfig } from '#features/widgets/types/queryWidget'
import {
  aggregateRows,
  bucketedRows,
  groupLabel,
  valuedRows,
} from '#features/widgets/utils/aggregateRows'
import { foldWeek } from '#features/widgets/utils/localHours'

/**
 * Turns a Query Widget's rows into the shape its chart kind draws. Group keys that a row lacks read
 * `Unknown`. A kind the rows cannot draw (`chartAvailability` says which) never gets here: the
 * editor refuses to save it and the Board refuses to run it.
 */
export function selectQueryData(
  config: QueryWidgetConfig,
  response: unknown,
  ctx: Pick<QueryContext, 'tz'>,
): QueryData {
  const rows = aggregateRows(response)
  const unit = (response as Partial<OperationOutput<'queryMetrics'>>).meta?.unit ?? null
  const { groupBy, bucket } = config
  const withValue = valuedRows(response)
  const timed = bucketedRows(response)
  const labelOf = (row: (typeof rows)[number], keys: readonly string[]) =>
    keys.length === 0 ? 'Value' : keys.map((key) => groupLabel(row, key)).join(' · ')
  const base = { unit, ...(bucket !== undefined && { bucket }) }

  switch (config.chart) {
    case 'stat':
      return { ...base, chart: 'stat', value: rows[0]?.value ?? null }
    case 'series':
      return {
        ...base,
        chart: 'series',
        points: timed.map((row) => ({
          x: row.bucket,
          series: labelOf(row, groupBy),
          value: row.value,
        })),
      }
    case 'bars':
      return {
        ...base,
        chart: 'bars',
        points:
          bucket === undefined
            ? withValue.map((row) => ({
                x: groupLabel(row, groupBy[0] ?? ''),
                series: labelOf(row, groupBy.slice(1)),
                value: row.value,
              }))
            : timed.map((row) => ({
                x: row.bucket,
                series: labelOf(row, groupBy),
                value: row.value,
              })),
      }
    case 'bar-list':
    case 'share':
      return {
        ...base,
        chart: config.chart,
        items: withValue.map((row) => ({ label: labelOf(row, groupBy), value: row.value })),
      }
    case 'table':
      return {
        ...base,
        chart: 'table',
        columns: [...(bucket === undefined ? [] : ['Time']), ...groupBy, 'Value'],
        rows: rows.map((row) => [
          ...(bucket === undefined ? [] : [row.bucket ?? null]),
          ...groupBy.map((key) => row.group[key] ?? null),
          row.value,
        ]),
      }
    case 'heatmap': {
      const buckets = timed.map((row) => ({ start: row.bucket, value: row.value }))
      return {
        ...base,
        chart: 'heatmap',
        cells: foldWeek(buckets, ctx.tz),
        hasData: buckets.length > 0,
      }
    }
  }
}

/** Whether there is nothing to draw: no rows, or (for a stat) no value. */
export function isEmptyQueryData(data: QueryData): boolean {
  switch (data.chart) {
    case 'stat':
      return data.value === null
    case 'series':
    case 'bars':
      return data.points.length === 0
    case 'bar-list':
    case 'share':
      return data.items.length === 0
    case 'table':
      return data.rows.length === 0
    case 'heatmap':
      return !data.hasData
  }
}
