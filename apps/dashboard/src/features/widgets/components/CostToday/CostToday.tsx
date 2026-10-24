import { Stat } from '@mitcsutt/kiln-ui'

import type { WidgetDefinition } from '#features/widgets/types/widget'
import { useMoney } from '#features/locale/hooks/useMoney'
import { aggregateRows } from '#features/widgets/utils/aggregateRows'
import { filterClause } from '#features/widgets/utils/filterClause'

export interface CostTodayData {
  /** Dollars so far today; `null` when the Hub holds no cost for the day. */
  cost: number | null
}

export const costToday: WidgetDefinition<CostTodayData> = {
  id: 'cost-today',
  group: 'spend',
  title: 'Cost today',
  description: 'What your Sessions have cost since midnight.',
  kind: 'stat',
  size: { w: 3, h: 2 },
  window: 'today',
  filters: ['source', 'account', 'model'],
  request: (ctx) => ({
    op: 'queryMetrics',
    body: {
      metric: 'claude_code.cost.usage',
      aggregation: 'sum',
      from: ctx.from,
      to: ctx.to,
      tz: ctx.tz,
      ...filterClause(ctx),
    },
  }),
  select: (response) => ({
    cost: aggregateRows(response)[0]?.value ?? null,
  }),
  isEmpty: ({ cost }) => cost === null,
  View: ({ data, label }) => {
    const money = useMoney()
    return <Stat label={label} size="lg" value={money.format(data.cost ?? 0)} />
  },
}
