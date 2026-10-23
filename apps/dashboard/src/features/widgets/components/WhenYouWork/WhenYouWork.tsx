import { Heatmap } from '@mitcsutt/kiln-charts'

import type { WidgetDefinition } from '#features/widgets/types/widget'
import { aggregateRows } from '#features/widgets/utils/aggregateRows'
import { formatDuration } from '#features/widgets/utils/formats'
import { foldWeek } from '#features/widgets/utils/localHours'

export interface WhenYouWorkData {
  /** Seconds of active time: Monday to Sunday, each with 24 local hours. */
  cells: number[][]
  /** Whether the Hub holds any active time in the window at all. */
  hasTime: boolean
}

const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const hours = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0'))

/** One heatmap row: the weekday's name, then a key per hour (`'00'` to `'23'`). */
function weekdayRow(name: string, cells: readonly number[]): Record<string, string | number> {
  const row: Record<string, string | number> = { day: name }
  for (const [hour, seconds] of cells.entries()) row[hours[hour] ?? ''] = seconds
  return row
}

export const whenYouWork: WidgetDefinition<WhenYouWorkData> = {
  id: 'when-you-work',
  group: 'rhythm',
  title: 'When you work',
  description: 'Active time by weekday and hour of the day, over the last 12 weeks.',
  kind: 'heatmap',
  size: { w: 5, h: 5 },
  minSize: { w: 4, h: 4 },
  window: 'last-12-weeks',
  filters: ['source', 'account'],
  request: (ctx) => ({
    op: 'queryMetrics',
    body: {
      metric: 'claude_code.active_time.total',
      aggregation: 'sum',
      from: ctx.from,
      to: ctx.to,
      tz: ctx.tz,
      bucket: 'hour',
      ...(ctx.filter.length > 0 && { filter: ctx.filter }),
    },
  }),
  select: (response, ctx) => {
    const buckets = aggregateRows(response).flatMap((row) =>
      row.bucket === undefined || row.value === null
        ? []
        : [{ start: row.bucket, value: row.value }],
    )
    return { cells: foldWeek(buckets, ctx.tz), hasTime: buckets.length > 0 }
  },
  isEmpty: ({ hasTime }) => !hasTime,
  View: ({ data, label }) => (
    <Heatmap
      data={data.cells.map((cells, day) => weekdayRow(weekdays[day] ?? '', cells))}
      x="day"
      columns={hours}
      label={label}
      format={(seconds) => formatDuration(seconds * 1_000)}
    />
  ),
}
