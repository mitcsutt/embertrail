import { Bars } from '@mitcsutt/kiln-charts'

import type { WidgetDefinition } from '#features/widgets/types/widget'
import { aggregateRows } from '#features/widgets/utils/aggregateRows'

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
  size: { w: 6, h: 4 },
  minSize: { w: 4, h: 3 },
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
      ...(ctx.filter.length > 0 && { filter: ctx.filter }),
    },
  }),
  select: (response) => ({
    rows: aggregateRows(response).flatMap((row) =>
      row.bucket === undefined || row.value === null
        ? []
        : [{ day: row.bucket, commits: row.value }],
    ),
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
