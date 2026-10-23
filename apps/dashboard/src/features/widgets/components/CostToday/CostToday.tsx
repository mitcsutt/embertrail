import type { OperationOutput } from '@mitcsutt/embertrail-client'
import { Stat } from '@mitcsutt/kiln-ui'

import type { WidgetDefinition } from '#features/widgets/types/widget'
import { formatUsd } from '#features/widgets/utils/formats'

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
      ...(ctx.filter.length > 0 && { filter: ctx.filter }),
    },
  }),
  select: (response) => ({
    cost: (response as OperationOutput<'queryMetrics'>).rows[0]?.value ?? null,
  }),
  isEmpty: ({ cost }) => cost === null,
  View: ({ data, label }) => <Stat label={label} size="lg" value={formatUsd(data.cost ?? 0)} />,
}
