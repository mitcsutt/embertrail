import type { Schemas } from '@mitcsutt/embertrail-client'

export type AggregateRow = Schemas['AggregateRow']

export type ValuedRow = AggregateRow & { value: number }
export type BucketedRow = ValuedRow & { bucket: string }

/** The rows of a `queryMetrics` answer or a `queryEvents` one in `aggregate` mode. */
export function aggregateRows(response: unknown): AggregateRow[] {
  return (response as { rows: AggregateRow[] }).rows
}

/** The rows that hold a value; a bucket with nothing to aggregate answers `null`. */
export function valuedRows(response: unknown): ValuedRow[] {
  return aggregateRows(response).filter((row): row is ValuedRow => row.value !== null)
}

/** The valued rows of a bucketed request. */
export function bucketedRows(response: unknown): BucketedRow[] {
  return valuedRows(response).filter((row): row is BucketedRow => row.bucket !== undefined)
}

/** The row's value for a `group_by` key as text, `Unknown` when the telemetry left it out. */
export function groupLabel(row: AggregateRow, key: string): string {
  return String(row.group[key] ?? 'Unknown')
}
