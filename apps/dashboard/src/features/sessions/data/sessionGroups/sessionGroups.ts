import { items } from '@mitcsutt/embertrail-client'
import type { EmbertrailClient } from '@mitcsutt/embertrail-client'
import { queryOptions, useQuery } from '@tanstack/react-query'

import type { QueryContext } from '#features/filters/types/filters'
import type { SessionSummary } from '#features/sessions/types/sessionTree'

export interface SessionGroupsParams {
  from: string
  to: string
  sessions: QueryContext['sessions']
}

/**
 * Every Session in the window, page after page. The Session Groups view totals them itself rather
 * than asking `queryMetrics` per group: a Session's `cost_usd` and tokens are its own sums, so a
 * group's total is exactly the sum of the rows listed under it (#44 AC1), which two different
 * queries over a window's edge would not promise.
 */
export async function fetchSessions(
  client: EmbertrailClient,
  params: SessionGroupsParams,
  signal?: AbortSignal,
): Promise<SessionSummary[]> {
  const all: SessionSummary[] = []
  const query = { ...params.sessions, from: params.from, to: params.to, limit: 1000 }
  for await (const session of items((cursor) =>
    client.listSessions({ query: cursor === undefined ? query : { ...query, cursor }, signal }),
  )) {
    all.push(session)
  }
  return all
}

export function sessionGroupsQueryOptions(client: EmbertrailClient, params: SessionGroupsParams) {
  return queryOptions({
    queryKey: ['session-groups', params],
    queryFn: ({ signal }) => fetchSessions(client, params, signal),
  })
}

export function useSessionGroups(client: EmbertrailClient, params: SessionGroupsParams) {
  return useQuery(sessionGroupsQueryOptions(client, params))
}
