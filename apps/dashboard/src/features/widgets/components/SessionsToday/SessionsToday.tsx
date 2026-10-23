import type { OperationOutput } from '@mitcsutt/embertrail-client'
import { Stat } from '@mitcsutt/kiln-ui'

import type { WidgetDefinition } from '#features/widgets/types/widget'

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
      ...(ctx.filter.length > 0 && { filter: ctx.filter }),
    },
  }),
  select: (response) => ({
    sessions: (response as OperationOutput<'queryMetrics'>).rows[0]?.value ?? null,
  }),
  isEmpty: ({ sessions }) => sessions === null,
  View: ({ data, label }) => (
    <Stat label={label} size="lg" value={new Intl.NumberFormat().format(data.sessions ?? 0)} />
  ),
}
