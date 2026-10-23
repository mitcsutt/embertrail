import { Bars } from '@mitcsutt/kiln-charts'

import type { WidgetDefinition } from '#features/widgets/types/widget'
import { bucketedRows, groupLabel } from '#features/widgets/utils/aggregateRows'
import { filterClause } from '#features/widgets/utils/filterClause'

/** One day's cost for one model: the long rows `Bars` pivots into one series per model. */
export interface DayModelCost {
  /** The day's start, an ISO time with its offset. */
  day: string
  model: string
  cost: number
}

export interface EachDayByModelData {
  rows: DayModelCost[]
}

export const eachDayByModel: WidgetDefinition<EachDayByModelData> = {
  id: 'each-day-by-model',
  group: 'spend',
  title: 'Each day by model',
  description: 'Daily cost, stacked by the model that incurred it.',
  kind: 'bars',
  size: { w: 12, h: 4 },
  minSize: { w: 4, h: 3 },
  window: 'board',
  filters: ['source', 'account', 'model'],
  request: (ctx) => ({
    op: 'queryMetrics',
    body: {
      metric: 'claude_code.cost.usage',
      aggregation: 'sum',
      from: ctx.from,
      to: ctx.to,
      tz: ctx.tz,
      bucket: 'day',
      group_by: ['model'],
      ...filterClause(ctx),
    },
  }),
  select: (response) => ({
    rows: bucketedRows(response).map((row) => ({
      day: row.bucket,
      model: groupLabel(row, 'model'),
      cost: row.value,
    })),
  }),
  isEmpty: ({ rows }) => rows.length === 0,
  View: ({ data, ctx, label }) => (
    <Bars
      data={data.rows.map((row) => ({ ...row }))}
      x="day"
      label={label}
      height="fill"
      pivot={{ by: 'model', value: 'cost' }}
      stacked
      format={{ style: 'currency', currency: 'USD' }}
      xFormat="date"
      timeZone={ctx.tz}
    />
  ),
}
