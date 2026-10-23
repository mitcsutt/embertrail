import type { OperationOutput } from '@mitcsutt/embertrail-client'
import { Link, Table } from '@mitcsutt/kiln-ui'
import { Link as RouterLink } from '@tanstack/react-router'

import type { WidgetDefinition } from '#features/widgets/types/widget'
import { formatUsd } from '#features/widgets/utils/formats'

export interface TopSession {
  id: string
  /** The first Signal, an ISO time; `null` for a Session known only from its Labels. */
  startedAt: string | null
  models: string[]
  cost: number
}

export interface TopSessionsData {
  sessions: TopSession[]
}

export const topSessions: WidgetDefinition<TopSessionsData> = {
  id: 'top-sessions',
  group: 'sessions',
  title: 'Top sessions',
  description: 'The most expensive Sessions in the period.',
  kind: 'table',
  size: { w: 7, h: 5 },
  minSize: { w: 4, h: 3 },
  window: 'board',
  filters: ['source', 'account', 'model'],
  request: (ctx) => ({
    op: 'listSessions',
    query: { ...ctx.sessions, from: ctx.from, to: ctx.to, sort: '-cost_usd', limit: 10 },
  }),
  select: (response) => ({
    // A sender without cost (not Claude Code) leaves `cost_usd` null; those Sessions rank nowhere.
    sessions: (response as OperationOutput<'listSessions'>).items.flatMap((session) =>
      session.cost_usd === null
        ? []
        : [
            {
              id: session.id,
              startedAt: session.started_at,
              models: session.models,
              cost: session.cost_usd,
            },
          ],
    ),
  }),
  isEmpty: ({ sessions }) => sessions.length === 0,
  View: ({ data, ctx, label }) => {
    const started = new Intl.DateTimeFormat(undefined, {
      timeZone: ctx.tz,
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
    return (
      <Table label={label} density="compact">
        <Table.Head>
          <Table.Row>
            <Table.HeaderCell>Session</Table.HeaderCell>
            <Table.HeaderCell>Started</Table.HeaderCell>
            <Table.HeaderCell>Models</Table.HeaderCell>
            <Table.HeaderCell numeric>Cost</Table.HeaderCell>
          </Table.Row>
        </Table.Head>
        <Table.Body>
          {data.sessions.map((session) => (
            <Table.Row key={session.id}>
              <Table.Cell rowHeader>
                <Link asChild>
                  <RouterLink to="/sessions/$sessionId" params={{ sessionId: session.id }}>
                    {session.id.slice(0, 8)}
                  </RouterLink>
                </Link>
              </Table.Cell>
              <Table.Cell>
                {session.startedAt === null ? '–' : started.format(new Date(session.startedAt))}
              </Table.Cell>
              <Table.Cell>{session.models.join(', ')}</Table.Cell>
              <Table.Cell numeric>{formatUsd(session.cost)}</Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
    )
  },
}
