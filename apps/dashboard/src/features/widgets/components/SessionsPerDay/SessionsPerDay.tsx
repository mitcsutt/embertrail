import { Bars } from '@mitcsutt/kiln-charts'

import type { WidgetDefinition } from '#features/widgets/types/widget'
import { bucketedRows, groupLabel } from '#features/widgets/utils/aggregateRows'
import { filterClause } from '#features/widgets/utils/filterClause'

/** The Sessions that started on one day in one way (`startup`, `resume`, ...). */
export interface DayStartTypeSessions {
  /** The day's start, an ISO time with its offset. */
  day: string
  startType: string
  sessions: number
}

export interface SessionsPerDayData {
  rows: DayStartTypeSessions[]
}

export const sessionsPerDay: WidgetDefinition<SessionsPerDayData> = {
  id: 'sessions-per-day',
  group: 'sessions',
  title: 'Sessions per day',
  description: 'Sessions started each day, stacked by how they started.',
  kind: 'bars',
  size: { w: 5, h: 6 },
  minSize: { w: 4, h: 4 },
  window: 'board',
  filters: ['source', 'account'],
  request: (ctx) => ({
    op: 'queryMetrics',
    body: {
      metric: 'claude_code.session.count',
      aggregation: 'sum',
      from: ctx.from,
      to: ctx.to,
      tz: ctx.tz,
      bucket: 'day',
      group_by: ['start_type'],
      ...filterClause(ctx),
    },
  }),
  select: (response) => ({
    rows: bucketedRows(response).map((row) => ({
      day: row.bucket,
      startType: groupLabel(row, 'start_type'),
      sessions: row.value,
    })),
  }),
  isEmpty: ({ rows }) => rows.length === 0,
  View: ({ data, ctx, label }) => (
    <Bars
      data={data.rows.map((row) => ({ ...row }))}
      x="day"
      label={label}
      height="fill"
      pivot={{ by: 'startType', value: 'sessions' }}
      stacked
      format="integer"
      xFormat="date"
      timeZone={ctx.tz}
    />
  ),
}
