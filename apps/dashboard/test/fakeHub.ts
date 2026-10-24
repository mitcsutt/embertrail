// A Hub in memory, for component tests. PGLite does not boot under jsdom, so a test that renders
// the app cannot use `dashboardTestHub`; this answers the handful of operations the app calls,
// through the real client, so errors, headers and paging behave as they do against a Hub. Boards
// are stored with a version: a write against `If-Match` or `If-None-Match` is checked the way the
// Hub checks it, so a stale one is refused with 412.

import { createClient } from '@mitcsutt/embertrail-client'
import type { EmbertrailClient, Schemas } from '@mitcsutt/embertrail-client'

import type { BoardDocument } from '#features/boards/types/board'
import { boardNamespace } from '#features/boards/types/board'

export interface FakeHubOptions {
  /** Stored Boards by id; a value that is not a Board is served as it is. */
  boards?: Record<string, BoardDocument | object>
  scopes?: string[]
  /** The Teams the caller belongs to, as `getSelf` reports them; none for a solo User. */
  teams?: Schemas['Self']['teams']
  /** Who owns a stored Board; a Board not listed is the caller's own. */
  owners?: Record<string, { kind: 'user' | 'team'; id: string }>
  /** The Sessions `listSessions` answers with, and `getSession` looks up (children by parent). */
  sessions?: Schemas['SessionSummary'][]
  /** The Events a list query pages through, `eventPageSize` at a time, whatever the filter. */
  events?: Schemas['Event'][]
  eventPageSize?: number
  /** What `getRates` answers; by default the Hub makes no outbound request (`off`). */
  rates?: Schemas['Rates']
}

export interface FakeHub {
  client: EmbertrailClient
  /** Every request, in order, as `METHOD /path?query` with the parsed JSON body. */
  requests: { line: string; path: string; body?: unknown; owner?: string }[]
  /** The Query API requests a Widget sends. */
  widgetRequests(): FakeHub['requests']
  /** The stored Board with this id, as the Hub holds it now. */
  board(id: string): unknown
  /** Who owns the stored Board with this id. */
  ownerOf(id: string): { kind: string; id: string } | undefined
  /** Another client saves a Board: it moves to its next version, as a concurrent save would. */
  saveElsewhere(id: string, data: unknown): void
  /** Another client deletes a Board. */
  deleteElsewhere(id: string): void
}

const json = (body: unknown, init: ResponseInit = {}) => {
  const headers = new Headers(init.headers)
  if (!headers.has('content-type')) headers.set('content-type', 'application/json')
  return new Response(JSON.stringify(body), { ...init, headers })
}

const problem = (status: number, type: string) =>
  json(
    { type: `urn:embertrail:problem:${type}`, title: type, status, request_id: 'req-1' },
    { status, headers: { 'content-type': 'application/problem+json' } },
  )

const owner = { kind: 'user', id: 'u1' }

const document = (id: string, data: unknown, version: number, by = owner) => ({
  namespace: boardNamespace,
  id,
  owner: by,
  version,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  data,
})

interface Stored {
  data: unknown
  version: number
  owner: { kind: string; id: string }
}

const etagOf = (version: number) => `"${String(version)}"`

export function fakeHub(options: FakeHubOptions = {}): FakeHub {
  const boards = new Map<string, Stored>(
    Object.entries(options.boards ?? {}).map(([id, data]) => [
      id,
      { data, version: 1, owner: options.owners?.[id] ?? owner },
    ]),
  )
  const requests: FakeHub['requests'] = []

  const respond = (method: string, url: URL, request: Request, body: unknown): Response => {
    const path = url.pathname
    if (path === '/api/v1/self') {
      return json({
        user: { id: 'u1', name: 'Dana', email: null, admin: false },
        scopes: options.scopes ?? ['otel:read', 'store:read', 'store:write'],
        teams: options.teams ?? [],
      })
    }
    if (path === '/api/v1/rates') {
      return json(
        options.rates ?? {
          status: 'off',
          base: 'USD',
          source: null,
          date: null,
          fetched_at: null,
          rates: null,
        },
      )
    }
    if (path === '/api/v1/inventory') {
      return json({
        owners: [{ id: 'u1', kind: 'user', name: 'Dana' }],
        sources: [{ id: 's1', name: 'embertrail-demo', owner_id: 'u1' }],
        accounts: [],
        services: [],
        models: ['claude-opus-4-7', 'claude-haiku-4-5'],
        metrics: [],
        events: [],
        attributes: [],
      })
    }
    if (
      path === '/api/v1/events/query' &&
      (body as { mode?: string } | undefined)?.mode === 'list'
    ) {
      const size = options.eventPageSize ?? 100
      const start = Number((body as { cursor?: string }).cursor ?? 0)
      const all = options.events ?? []
      const next = start + size
      return json({
        items: all.slice(start, next),
        next_cursor: next < all.length ? String(next) : null,
      })
    }
    if (path === '/api/v1/metrics/query' || path === '/api/v1/events/query') {
      return json({ rows: [], meta: {} })
    }
    if (path === '/api/v1/sessions')
      return json({ items: options.sessions ?? [], next_cursor: null })
    const session = /^\/api\/v1\/sessions\/([^/]+)$/.exec(path)
    if (session !== null) {
      const found = (options.sessions ?? []).find((candidate) => candidate.id === session[1])
      return found === undefined
        ? problem(404, 'not-found')
        : json({
            ...found,
            children: (options.sessions ?? []).filter((c) => c.parent_session_id === found.id),
          })
    }

    const store = new RegExp(`^/api/v1/store/${boardNamespace}(?:/([^/]+))?$`).exec(path)
    if (store === null) return problem(404, 'not-found')
    const id = store[1]
    if (method === 'GET' && id === undefined) {
      return json({
        items: [...boards].map(([key, { data, version, owner: by }]) =>
          document(key, data, version, by),
        ),
        next_cursor: null,
      })
    }
    if (id === undefined) return problem(404, 'not-found')
    const current = boards.get(id)
    if (method === 'GET') {
      return current === undefined
        ? problem(404, 'not-found')
        : json(document(id, current.data, current.version, current.owner), {
            headers: { ETag: etagOf(current.version) },
          })
    }
    const ifMatch = request.headers.get('if-match')
    // Acting for a Team takes its editor; a Team's document is written only when acting for it.
    const acting = /^team:(.+)$/.exec(request.headers.get('embertrail-owner') ?? '')?.[1]
    const editor = (teamId: string) =>
      (options.teams ?? []).some((team) => team.id === teamId && team.editor)
    if (acting !== undefined && !editor(acting)) return problem(403, 'forbidden')
    if (current?.owner.kind === 'team' && acting !== current.owner.id) {
      return problem(403, 'forbidden')
    }
    if (method === 'PUT') {
      if (request.headers.get('if-none-match') === '*' && current !== undefined) {
        return problem(412, 'precondition-failed')
      }
      if (ifMatch !== null && current === undefined) return problem(404, 'not-found')
      if (ifMatch !== null && current !== undefined && ifMatch !== etagOf(current.version)) {
        return problem(412, 'precondition-failed')
      }
      const version = (current?.version ?? 0) + 1
      const { data } = body as { data: unknown }
      const by = current?.owner ?? (acting === undefined ? owner : { kind: 'team', id: acting })
      boards.set(id, { data, version, owner: by })
      return json(document(id, data, version, by), {
        status: current === undefined ? 201 : 200,
        headers: { ETag: etagOf(version) },
      })
    }
    if (method === 'DELETE') {
      if (current === undefined) return problem(404, 'not-found')
      if (ifMatch !== null && ifMatch !== etagOf(current.version)) {
        return problem(412, 'precondition-failed')
      }
      boards.delete(id)
      return new Response(null, { status: 204 })
    }
    return problem(404, 'not-found')
  }

  const client = createClient({
    baseUrl: 'http://hub.test',
    fetch: async (input, init) => {
      const request = new Request(input, init)
      const url = new URL(request.url)
      const text = await request.text()
      const body = text === '' ? undefined : (JSON.parse(text) as unknown)
      requests.push({
        line: `${request.method} ${url.pathname}${url.search}`,
        path: url.pathname,
        ...(body === undefined ? {} : { body }),
        ...(request.headers.has('embertrail-owner')
          ? { owner: request.headers.get('embertrail-owner') ?? '' }
          : {}),
      })
      return respond(request.method, url, request, body)
    },
  })

  return {
    client,
    requests,
    widgetRequests: () =>
      requests.filter(({ path }) =>
        ['/api/v1/metrics/query', '/api/v1/events/query', '/api/v1/sessions'].includes(path),
      ),
    board: (id) => boards.get(id)?.data,
    ownerOf: (id) => boards.get(id)?.owner,
    saveElsewhere(id, data) {
      boards.set(id, {
        data,
        version: (boards.get(id)?.version ?? 0) + 1,
        owner: boards.get(id)?.owner ?? owner,
      })
    },
    deleteElsewhere(id) {
      boards.delete(id)
    },
  }
}
