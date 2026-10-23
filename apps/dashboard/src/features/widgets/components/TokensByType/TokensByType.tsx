import type { OperationOutput } from '@mitcsutt/embertrail-client'
import { TimeSeries } from '@mitcsutt/kiln-charts'

import type { WidgetDefinition } from '#features/widgets/types/widget'

/** One day's tokens of one type (`input`, `output`, `cacheRead`, `cacheCreation`). */
export interface DayTypeTokens {
  /** The day's start, an ISO time with its offset. */
  day: string
  type: string
  tokens: number
}

export interface TokensByTypeData {
  rows: DayTypeTokens[]
}

export const tokensByType: WidgetDefinition<TokensByTypeData> = {
  id: 'tokens-by-type',
  group: 'models',
  title: 'Tokens by type',
  description: 'Tokens used each day, stacked by type.',
  kind: 'series',
  size: { w: 12, h: 4 },
  minSize: { w: 4, h: 3 },
  window: 'board',
  filters: ['source', 'account', 'model'],
  request: (ctx) => ({
    op: 'queryMetrics',
    body: {
      metric: 'claude_code.token.usage',
      aggregation: 'sum',
      from: ctx.from,
      to: ctx.to,
      tz: ctx.tz,
      bucket: 'day',
      group_by: ['type'],
      ...(ctx.filter.length > 0 && { filter: ctx.filter }),
    },
  }),
  select: (response) => ({
    rows: (response as OperationOutput<'queryMetrics'>).rows.flatMap((row) =>
      row.bucket === undefined || row.value === null
        ? []
        : [{ day: row.bucket, type: String(row.group.type ?? 'Unknown'), tokens: row.value }],
    ),
  }),
  isEmpty: ({ rows }) => rows.length === 0,
  View: ({ data, ctx, label }) => (
    <TimeSeries
      data={data.rows.map((row) => ({ ...row }))}
      x="day"
      label={label}
      height="fill"
      pivot={{ by: 'type', value: 'tokens' }}
      variant="stacked"
      format="compact"
      xFormat="date"
      timeZone={ctx.tz}
    />
  ),
}
