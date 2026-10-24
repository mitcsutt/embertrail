import { Stat } from '@mitcsutt/kiln-ui'

import { useLocale } from '#features/locale/hooks/useLocale'
import type { WidgetDefinition } from '#features/widgets/types/widget'
import { aggregateRows } from '#features/widgets/utils/aggregateRows'
import { filterClause } from '#features/widgets/utils/filterClause'

export interface SessionsTodayData {
  /** Sessions started today; `null` when the Hub holds no session count for the day. */
  sessions: number | null
}

export const sessionsToday: WidgetDefinition<SessionsTodayData> = {
  id: 'sessions-today',
  group: 'sessions',
  title: 'Sessions today',
  description: 'How many Sessions you have started since midnight.',
  kind: 'stat',
  size: { w: 3, h: 2 },
  window: 'today',
  // `session.count` has no model: filtering by one would empty it.
  filters: ['source', 'account'],
  request: (ctx) => ({
    op: 'queryMetrics',
    body: {
      metric: 'claude_code.session.count',
      aggregation: 'sum',
      from: ctx.from,
      to: ctx.to,
      tz: ctx.tz,
      ...filterClause(ctx),
    },
  }),
  select: (response) => ({
    sessions: aggregateRows(response)[0]?.value ?? null,
  }),
  isEmpty: ({ sessions }) => sessions === null,
  View: ({ data, label }) => {
    const { locale } = useLocale()
    return (
      <Stat
        label={label}
        size="lg"
        value={new Intl.NumberFormat(locale).format(data.sessions ?? 0)}
      />
    )
  },
}
