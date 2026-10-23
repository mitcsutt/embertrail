import { Stat } from '@mitcsutt/kiln-ui'

import type { WidgetDefinition } from '#features/widgets/types/widget'
import { formatPercent } from '#features/widgets/utils/formats'
import { aggregateRows } from '#features/widgets/utils/aggregateRows'
import { filterClause } from '#features/widgets/utils/filterClause'

export interface CacheShareData {
  /** Cached input as a fraction (0 to 1) of all input; `null` when no input tokens were counted. */
  share: number | null
}

export const cacheShare: WidgetDefinition<CacheShareData> = {
  id: 'cache-share',
  group: 'models',
  title: 'Cache share',
  description: 'How much of the input came from the prompt cache.',
  kind: 'stat',
  size: { w: 3, h: 2 },
  window: 'board',
  filters: ['source', 'account', 'model'],
  request: (ctx) => ({
    op: 'queryMetrics',
    body: {
      metric: 'claude_code.token.usage',
      aggregation: 'sum',
      from: ctx.from,
      to: ctx.to,
      tz: ctx.tz,
      group_by: ['type'],
      ...filterClause(ctx),
    },
  }),
  select: (response) => {
    const tokens: Record<string, number> = {}
    for (const row of aggregateRows(response)) {
      if (row.value !== null) tokens[String(row.group.type)] = row.value
    }
    // Output tokens are not input, so they stay out of the denominator.
    const input = (tokens.input ?? 0) + (tokens.cacheRead ?? 0) + (tokens.cacheCreation ?? 0)
    return { share: input === 0 ? null : (tokens.cacheRead ?? 0) / input }
  },
  isEmpty: ({ share }) => share === null,
  View: ({ data, label }) => (
    <Stat
      label={label}
      size="lg"
      value={formatPercent(data.share ?? 0)}
      hint="of input read from the cache"
    />
  ),
}
