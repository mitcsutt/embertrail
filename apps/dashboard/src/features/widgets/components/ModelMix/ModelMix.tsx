import { Share } from '@mitcsutt/kiln-charts'

import type { WidgetDefinition } from '#features/widgets/types/widget'
import { valuedRows, groupLabel } from '#features/widgets/utils/aggregateRows'
import { filterClause } from '#features/widgets/utils/filterClause'

export interface ModelCost {
  model: string
  cost: number
}

export interface ModelMixData {
  models: ModelCost[]
}

export const modelMix: WidgetDefinition<ModelMixData> = {
  id: 'model-mix',
  group: 'models',
  title: 'Model mix',
  description: 'How the period’s cost splits between models.',
  kind: 'share',
  size: { w: 4, h: 4 },
  minSize: { w: 3, h: 3 },
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
      group_by: ['model'],
      ...filterClause(ctx),
    },
  }),
  select: (response) => ({
    models: valuedRows(response).map((row) => ({
      model: groupLabel(row, 'model'),
      cost: row.value,
    })),
  }),
  isEmpty: ({ models }) => models.length === 0,
  View: ({ data, label }) => (
    <Share
      data={data.models.map((row) => ({ ...row }))}
      pivot={{ by: 'model', value: 'cost' }}
      label={label}
      format={{ style: 'currency', currency: 'USD' }}
      totalLabel="total"
    />
  ),
}
