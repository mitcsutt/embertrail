import { Bars } from '@mitcsutt/kiln-charts'

import type { WidgetDefinition } from '#features/widgets/types/widget'
import { formatDuration } from '#features/widgets/utils/formats'
import { bucketedRows, groupLabel } from '#features/widgets/utils/aggregateRows'
import { filterClause } from '#features/widgets/utils/filterClause'

export interface DayActiveTime {
  /** The day's start, an ISO time with its offset. */
  day: string
  type: string
  seconds: number
}

export interface ActiveTimePerDayData {
  rows: DayActiveTime[]
}

export const activeTimePerDay: WidgetDefinition<ActiveTimePerDayData> = {
  id: 'active-time-per-day',
  group: 'rhythm',
  title: 'Active time per day',
  description: 'Time spent at the keyboard and time Claude spent working, each day.',
  kind: 'bars',
  size: { w: 7, h: 4 },
  minSize: { w: 4, h: 3 },
  window: 'board',
  filters: ['source', 'account'],
  request: (ctx) => ({
    op: 'queryMetrics',
    body: {
      metric: 'claude_code.active_time.total',
      aggregation: 'sum',
      from: ctx.from,
      to: ctx.to,
      tz: ctx.tz,
      bucket: 'day',
      group_by: ['type'],
      ...filterClause(ctx),
    },
  }),
  select: (response) => ({
    rows: bucketedRows(response).map((row) => ({
      day: row.bucket,
      type: groupLabel(row, 'type'),
      seconds: row.value,
    })),
  }),
  isEmpty: ({ rows }) => rows.length === 0,
  View: ({ data, ctx, label }) => (
    <Bars
      data={data.rows.map((row) => ({ ...row }))}
      x="day"
      label={label}
      height="fill"
      pivot={{ by: 'type', value: 'seconds' }}
      series={[
        { key: 'user', label: 'You' },
        { key: 'cli', label: 'Claude' },
      ]}
      stacked
      format={(seconds) => formatDuration(seconds * 1_000)}
      xFormat="date"
      timeZone={ctx.tz}
    />
  ),
}
