import { Bars } from '@mitcsutt/kiln-charts'

import type { WidgetDefinition } from '#features/widgets/types/widget'
import { bucketedRows, groupLabel } from '#features/widgets/utils/aggregateRows'
import { filterClause } from '#features/widgets/utils/filterClause'

export interface DayLines {
  /** The day's start, an ISO time with its offset. */
  day: string
  type: string
  lines: number
}

export interface LinesChangedPerDayData {
  rows: DayLines[]
}

export const linesChangedPerDay: WidgetDefinition<LinesChangedPerDayData> = {
  id: 'lines-changed-per-day',
  group: 'output',
  title: 'Lines changed per day',
  description: 'Lines of code Claude added and removed each day.',
  kind: 'bars',
  size: { w: 6, h: 4 },
  minSize: { w: 4, h: 3 },
  window: 'board',
  filters: ['source', 'account'],
  request: (ctx) => ({
    op: 'queryMetrics',
    body: {
      metric: 'claude_code.lines_of_code.count',
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
      lines: row.value,
    })),
  }),
  isEmpty: ({ rows }) => rows.length === 0,
  View: ({ data, ctx, label }) => (
    <Bars
      data={data.rows.map((row) => ({ ...row }))}
      x="day"
      label={label}
      height="fill"
      pivot={{ by: 'type', value: 'lines' }}
      series={[
        { key: 'added', label: 'Added' },
        { key: 'removed', label: 'Removed' },
      ]}
      stacked
      format="integer"
      xFormat="date"
      timeZone={ctx.tz}
    />
  ),
}
