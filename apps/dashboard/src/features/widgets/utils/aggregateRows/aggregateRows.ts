import type { Schemas } from '@mitcsutt/embertrail-client'

export type AggregateRow = Schemas['AggregateRow']

/** The rows of a `queryMetrics` answer or a `queryEvents` one in `aggregate` mode. */
export function aggregateRows(response: unknown): AggregateRow[] {
  return (response as { rows: AggregateRow[] }).rows
}
