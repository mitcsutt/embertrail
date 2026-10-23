import type { OperationOutput } from '@mitcsutt/embertrail-client'
import { Share } from '@mitcsutt/kiln-charts'

import type { WidgetDefinition } from '#features/widgets/types/widget'

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
      ...(ctx.filter.length > 0 && { filter: ctx.filter }),
    },
  }),
  select: (response) => ({
    models: (response as OperationOutput<'queryMetrics'>).rows.flatMap((row) =>
      row.value === null ? [] : [{ model: String(row.group.model ?? 'Unknown'), cost: row.value }],
    ),
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
