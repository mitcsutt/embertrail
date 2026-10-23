// A Hub in memory, for component tests. PGLite does not boot under jsdom, so a test that renders
// the app cannot use `dashboardTestHub`; this answers the handful of operations the app calls,
// through the real client, so errors, headers and paging behave as they do against a Hub.

import { createClient } from '@mitcsutt/embertrail-client'
import type { EmbertrailClient } from '@mitcsutt/embertrail-client'

import type { BoardDocument } from '#features/boards/types/board'
import { boardNamespace } from '#features/boards/types/board'

export interface FakeHubOptions {
  /** Stored Boards by id; a value that is not a Board is served as it is. */
  boards?: Record<string, BoardDocument | object>
  scopes?: string[]
}

export interface FakeHub {
  client: EmbertrailClient
  /** Every request, in order, as `METHOD /path?query` with the parsed JSON body. */
  requests: { line: string; path: string; body?: unknown }[]
  /** The Query API requests a Widget sends. */
  widgetRequests(): FakeHub['requests']
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

const document = (id: string, data: unknown) => ({
  namespace: boardNamespace,
  id,
  owner,
  version: 1,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  data,
})

export function fakeHub(options: FakeHubOptions = {}): FakeHub {
  const boards = new Map(Object.entries(options.boards ?? {}))
  const requests: FakeHub['requests'] = []

  const respond = (method: string, url: URL): Response => {
    const path = url.pathname
    if (path === '/api/v1/self') {
      return json({
        user: { id: 'u1', name: 'Dana', email: null, admin: false },
        scopes: options.scopes ?? ['otel:read', 'store:read', 'store:write'],
        teams: [],
      })
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
    if (path === '/api/v1/metrics/query' || path === '/api/v1/events/query') {
      return json({ rows: [], meta: {} })
    }
    if (path === '/api/v1/sessions') return json({ items: [], next_cursor: null })

    const store = new RegExp(`^/api/v1/store/${boardNamespace}(?:/([^/]+))?$`).exec(path)
    if (store !== null && method === 'GET') {
      const id = store[1]
      if (id === undefined) {
        return json({
          items: [...boards].map(([key, data]) => document(key, data)),
          next_cursor: null,
        })
      }
      const data = boards.get(id)
      return data === undefined
        ? problem(404, 'not-found')
        : json(document(id, data), { headers: { ETag: '"1"' } })
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
      })
      return respond(request.method, url)
    },
  })

  return {
    client,
    requests,
    widgetRequests: () =>
      requests.filter(({ path }) =>
        ['/api/v1/metrics/query', '/api/v1/events/query', '/api/v1/sessions'].includes(path),
      ),
  }
}
