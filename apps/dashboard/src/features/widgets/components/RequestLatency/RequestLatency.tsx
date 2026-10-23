import { TimeSeries } from '@mitcsutt/kiln-charts'

import type { WidgetDefinition } from '#features/widgets/types/widget'
import { aggregateRows } from '#features/widgets/utils/aggregateRows'
import { chartBucket } from '#features/widgets/utils/chartBucket'
import { formatDuration } from '#features/widgets/utils/formats'

export interface BucketLatency {
  /** The bucket's start, an ISO time with its offset. */
  at: string
  model: string
  /** The 95th percentile of the requests' duration, in milliseconds. */
  p95: number
}

export interface RequestLatencyData {
  rows: BucketLatency[]
}

export const requestLatency: WidgetDefinition<RequestLatencyData> = {
  id: 'request-latency',
  group: 'reliability',
  title: 'Request latency',
  description: 'How long the slowest 5% of API requests took, by model.',
  kind: 'series',
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
      filter: [{ key: 'event.name', op: 'eq', value: 'api_request' }, ...ctx.filter],
      aggregation: { fn: 'p95', key: 'duration_ms' },
      bucket: chartBucket(ctx),
      group_by: ['model'],
    },
  }),
  select: (response) => ({
    rows: aggregateRows(response).flatMap((row) =>
      row.bucket === undefined || row.value === null
        ? []
        : [{ at: row.bucket, model: String(row.group.model ?? 'Unknown'), p95: row.value }],
    ),
  }),
  isEmpty: ({ rows }) => rows.length === 0,
  View: ({ data, ctx, label }) => (
    <TimeSeries
      data={data.rows.map((row) => ({ ...row }))}
      x="at"
      label={label}
      height="fill"
      pivot={{ by: 'model', value: 'p95' }}
      format={(ms) => formatDuration(ms)}
      xFormat={chartBucket(ctx) === 'hour' ? 'datetime' : 'date'}
      timeZone={ctx.tz}
    />
  ),
}
