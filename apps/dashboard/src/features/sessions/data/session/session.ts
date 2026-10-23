import { isProblemError } from '@mitcsutt/embertrail-client'
import type { EmbertrailClient, Schemas } from '@mitcsutt/embertrail-client'
import { queryOptions, useInfiniteQuery, useQuery } from '@tanstack/react-query'

export type SessionDetail = Schemas['SessionDetail']
export type HubEvent = Schemas['Event']

const eventsPerPage = 100

const retryOnce = (count: number, error: unknown) =>
  !(isProblemError(error) && error.status < 500) && count < 1

export function sessionQueryOptions(client: EmbertrailClient, sessionId: string) {
  return queryOptions({
    queryKey: ['session', sessionId],
    queryFn: ({ signal }) => client.getSession({ path: { session_id: sessionId }, signal }),
    // A Session the Hub does not know, or a Scope it lacks, will be refused again.
    retry: retryOnce,
  })
}

/** One Session with its direct children. */
export function useSession(client: EmbertrailClient, sessionId: string) {
  return useQuery(sessionQueryOptions(client, sessionId))
}

/** The span in which a Session has Signals: its first Signal to just after its last. */
export function sessionSpan(session: Pick<SessionDetail, 'started_at' | 'last_seen_at'>) {
  if (session.started_at === null || session.last_seen_at === null) return undefined
  return {
    from: session.started_at,
    // `to` is exclusive, and the last Signal is at `last_seen_at`.
    to: new Date(new Date(session.last_seen_at).getTime() + 1000).toISOString(),
  }
}

/** One page of a Session's Events, oldest first; `cursor` is the previous page's `next_cursor`. */
export async function fetchEventsPage(
  client: EmbertrailClient,
  sessionId: string,
  span: { from: string; to: string },
  tz: string,
  cursor?: string,
  signal?: AbortSignal,
): Promise<Schemas['EventList']> {
  const page = await client.queryEvents({
    body: {
      mode: 'list',
      from: span.from,
      to: span.to,
      tz,
      filter: [{ key: 'session.id', op: 'eq', value: sessionId }],
      order: 'asc',
      limit: eventsPerPage,
      ...(cursor === undefined ? {} : { cursor }),
    },
    signal,
  })
  // `mode: 'list'` answers an EventList; the union is the aggregate's too.
  if (!('items' in page)) throw new Error('The Hub answered a list query with aggregate rows.')
  return page
}

/**
 * A Session's Events, oldest first, a page at a time through the cursor. Waits for the Session's
 * span; a Session known only from Labels has no Events to ask for.
 */
export function useSessionEvents(
  client: EmbertrailClient,
  sessionId: string,
  span: { from: string; to: string } | undefined,
  tz: string,
) {
  return useInfiniteQuery({
    queryKey: ['session-events', sessionId, span, tz],
    enabled: span !== undefined,
    retry: retryOnce,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      span === undefined
        ? Promise.resolve({ items: [], next_cursor: null })
        : fetchEventsPage(client, sessionId, span, tz, pageParam, signal),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })
}
