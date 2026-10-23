import { Chart } from '@mitcsutt/kiln-charts'

import type { WidgetDefinition } from '#features/widgets/types/widget'
import { aggregateRows } from '#features/widgets/utils/aggregateRows'
import { todayVsTypical } from '#features/widgets/utils/localHours'

export interface HourCost {
  /** The local hour, `09:00`. */
  hour: string
  /** Today's cost in the hour; `null` for an hour not reached yet. */
  today: number | null
  /** The mean cost in this hour over the other days of the window. */
  typical: number | null
}

export interface TodayByHourVsTypicalData {
  hours: HourCost[]
  /** Whether the Hub holds any cost in the window at all. */
  hasCost: boolean
}

export const todayByHourVsTypical: WidgetDefinition<TodayByHourVsTypicalData> = {
  id: 'today-by-hour-vs-typical',
  group: 'rhythm',
  title: 'Today by hour vs typical',
  description: 'Cost so far today in each hour, against the mean of the other 27 days.',
  kind: 'series',
  size: { w: 8, h: 4 },
  minSize: { w: 4, h: 3 },
  window: 'last-28-days',
  filters: ['source', 'account', 'model'],
  request: (ctx) => ({
    op: 'queryMetrics',
    body: {
      metric: 'claude_code.cost.usage',
      aggregation: 'sum',
      from: ctx.from,
      to: ctx.to,
      tz: ctx.tz,
      bucket: 'hour',
      ...(ctx.filter.length > 0 && { filter: ctx.filter }),
    },
  }),
  select: (response, ctx) => {
    const rows = aggregateRows(response)
    const buckets = rows.flatMap((row) =>
      row.bucket === undefined || row.value === null
        ? []
        : [{ start: row.bucket, value: row.value }],
    )
    return {
      hasCost: buckets.length > 0,
      hours: todayVsTypical(buckets, ctx).map(({ hour, today, typical }) => ({
        hour: `${String(hour).padStart(2, '0')}:00`,
        today,
        typical,
      })),
    }
  },
  isEmpty: ({ hasCost }) => !hasCost,
  View: ({ data, label }) => (
    <Chart
      data={data.hours.map((hour) => ({ ...hour }))}
      x="hour"
      label={label}
      height="fill"
      format={{ style: 'currency', currency: 'USD' }}
    >
      <Chart.Grid />
      <Chart.XAxis />
      <Chart.YAxis />
      <Chart.Line dataKey="today" label="Today" />
      <Chart.Line dataKey="typical" label="Typical day" variant="dashed" />
      <Chart.Tooltip />
      <Chart.Legend />
    </Chart>
  ),
}
