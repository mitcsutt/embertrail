import { Bars } from '@mitcsutt/kiln-charts'

import type { WidgetDefinition } from '#features/widgets/types/widget'
import { bucketedRows } from '#features/widgets/utils/aggregateRows'
import { filterClause } from '#features/widgets/utils/filterClause'

export interface DayCommits {
  /** The day's start, an ISO time with its offset. */
  day: string
  commits: number
}

export interface CommitsPerDayData {
  rows: DayCommits[]
}

export const commitsPerDay: WidgetDefinition<CommitsPerDayData> = {
  id: 'commits-per-day',
  group: 'output',
  title: 'Commits per day',
  description: 'Commits Claude made each day.',
  kind: 'bars',
  size: { w: 6, h: 6 },
  minSize: { w: 4, h: 4 },
  window: 'board',
  filters: ['source', 'account'],
  request: (ctx) => ({
    op: 'queryMetrics',
    body: {
      metric: 'claude_code.commit.count',
      aggregation: 'sum',
      from: ctx.from,
      to: ctx.to,
      tz: ctx.tz,
      bucket: 'day',
      ...filterClause(ctx),
    },
  }),
  select: (response) => ({
    rows: bucketedRows(response).map((row) => ({ day: row.bucket, commits: row.value })),
  }),
  isEmpty: ({ rows }) => rows.length === 0,
  View: ({ data, ctx, label }) => (
    <Bars
      data={data.rows.map((row) => ({ ...row }))}
      x="day"
      label={label}
      height="fill"
      series={[{ key: 'commits', label: 'Commits' }]}
      format="integer"
      xFormat="date"
      timeZone={ctx.tz}
    />
  ),
}
