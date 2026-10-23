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
    // The legend lists every model and has no height of its own, so a short Widget scrolls it.
    // The scroller is focusable and named so the keyboard can scroll it.
    <div
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region needs keyboard access
      tabIndex={0}
      role="region"
      aria-label={label}
      style={{ height: '100%', minHeight: 0, overflow: 'auto' }}
    >
      <Share
        data={data.models.map((row) => ({ ...row }))}
        pivot={{ by: 'model', value: 'cost' }}
        label={label}
        height="fill"
        format={{ style: 'currency', currency: 'USD' }}
        totalLabel="total"
      />
    </div>
  ),
}
