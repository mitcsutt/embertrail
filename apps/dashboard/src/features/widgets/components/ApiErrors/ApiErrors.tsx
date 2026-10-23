import { Bars } from '@mitcsutt/kiln-charts'

import type { WidgetDefinition } from '#features/widgets/types/widget'
import { aggregateRows } from '#features/widgets/utils/aggregateRows'
import { chartBucket } from '#features/widgets/utils/chartBucket'

export interface BucketErrors {
  /** The bucket's start, an ISO time with its offset. */
  at: string
  /** The HTTP status the API answered with. */
  status: string
  errors: number
}

export interface ApiErrorsData {
  rows: BucketErrors[]
}

export const apiErrors: WidgetDefinition<ApiErrorsData> = {
  id: 'api-errors',
  group: 'reliability',
  title: 'API errors',
  description: 'Requests the API answered with an error, by status.',
  kind: 'bars',
  size: { w: 6, h: 4 },
  minSize: { w: 4, h: 3 },
  window: 'board',
  filters: ['source', 'account', 'model'],
  request: (ctx) => ({
    op: 'queryEvents',
    body: {
      mode: 'aggregate',
      from: ctx.from,
      to: ctx.to,
      tz: ctx.tz,
      filter: [{ key: 'event.name', op: 'eq', value: 'api_error' }, ...ctx.filter],
      aggregation: { fn: 'count' },
      bucket: chartBucket(ctx),
      group_by: ['status_code'],
    },
  }),
  select: (response) => ({
    rows: aggregateRows(response).flatMap((row) =>
      row.bucket === undefined || row.value === null
        ? []
        : [
            {
              at: row.bucket,
              status: String(row.group.status_code ?? 'Unknown'),
              errors: row.value,
            },
          ],
    ),
  }),
  isEmpty: ({ rows }) => rows.length === 0,
  View: ({ data, ctx, label }) => (
    <Bars
      data={data.rows.map((row) => ({ ...row }))}
      x="at"
      label={label}
      height="fill"
      pivot={{ by: 'status', value: 'errors' }}
      stacked
      format="integer"
      xFormat={chartBucket(ctx) === 'hour' ? 'datetime' : 'date'}
      timeZone={ctx.tz}
    />
  ),
}
