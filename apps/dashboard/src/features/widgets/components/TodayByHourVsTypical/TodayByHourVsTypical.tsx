import { Chart } from '@mitcsutt/kiln-charts'

import { useMoney } from '#features/locale/hooks/useMoney'
import type { WidgetDefinition } from '#features/widgets/types/widget'
import { todayVsTypical } from '#features/widgets/utils/localHours'
import { bucketedRows } from '#features/widgets/utils/aggregateRows'
import { filterClause } from '#features/widgets/utils/filterClause'

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
  size: { w: 7, h: 6 },
  minSize: { w: 4, h: 4 },
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
      ...filterClause(ctx),
    },
  }),
  select: (response, ctx) => {
    const buckets = bucketedRows(response).map((row) => ({ start: row.bucket, value: row.value }))
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
  View: ({ data, label }) => {
    const money = useMoney()
    return (
      <Chart
        data={data.hours.map(({ hour, today, typical }) => ({
          hour,
          today: today === null ? null : money.scale(today),
          typical: typical === null ? null : money.scale(typical),
        }))}
        x="hour"
        label={label}
        height="fill"
        format={money.plain}
      >
        <Chart.Grid />
        <Chart.XAxis />
        <Chart.YAxis />
        <Chart.Line dataKey="today" label="Today" />
        <Chart.Line dataKey="typical" label="Typical day" variant="dashed" />
        <Chart.Tooltip />
        <Chart.Legend />
      </Chart>
    )
  },
}
