import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { startMockHub, type MockHub, type MockResponse } from '../test/mock-hub.ts'
import { requestExample } from '../test/spec.ts'

import {
  createClient,
  type EmbertrailClient,
  type OperationId,
  type OperationInput,
  type OperationOutput,
  type Schemas,
} from './index.ts'

let hub: MockHub
let client: EmbertrailClient

beforeAll(async () => {
  hub = await startMockHub()
  client = createClient({ baseUrl: hub.baseUrl, token: 'et_test_secret' })
})
afterAll(() => hub.close())
beforeEach(() => {
  hub.requests.length = 0
})

const session: Schemas['SessionSummary'] = {
  id: '6f1c2b9e-0000-4000-8000-000000000000',
  service_name: 'claude-code',
  owner_id: 'u1',
  source_id: 's1',
  account_id: 'a1',
  started_at: '2026-10-09T08:00:00Z',
  last_seen_at: '2026-10-09T09:00:00Z',
  models: ['claude-sonnet-5-5'],
  cost_usd: 1.25,
  tokens: { input: 1200, output: 340 },
  event_counts: { api_request: 4 },
  group: { id: 'batch-2026-10-10', kind: 'orchestrator' },
  parent_session_id: null,
  role: null,
  labels: { ticket: 'ABC-123' },
}

const document: Schemas['StoreDocument'] = {
  namespace: 'embertrail-dashboard',
  id: 'overview',
  owner: { kind: 'user', id: 'u1' },
  version: 3,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-09T00:00:00Z',
  data: { widgets: [] },
}

const aggregate: Schemas['AggregateResult'] = {
  rows: [
    { bucket: '2026-10-01T00:00:00+02:00', group: { model: 'claude-sonnet-5-5' }, value: 2.5 },
  ],
  meta: { tz: 'Europe/Berlin', bucket: 'day', unit: 'USD' },
}

interface Case<K extends OperationId> {
  input: OperationInput<K>
  /** What the Hub should receive. */
  request: { method: string; url: string; body?: unknown; headers?: Record<string, string> }
  response: MockResponse
  output: OperationOutput<K>
}

// One case per operation. The mapped type makes typecheck fail when the spec
// gains an operation that has no case here.
const cases: { [K in OperationId]: Case<K> } = {
  queryMetrics: {
    input: { body: requestExample('/api/v1/metrics/query', 'post') },
    request: {
      method: 'POST',
      url: '/api/v1/metrics/query',
      body: requestExample('/api/v1/metrics/query', 'post'),
      headers: { 'content-type': 'application/json' },
    },
    response: { status: 200, body: aggregate },
    output: aggregate,
  },
  queryEvents: {
    input: { body: requestExample('/api/v1/events/query', 'post', 'aggregate') },
    request: {
      method: 'POST',
      url: '/api/v1/events/query',
      body: requestExample('/api/v1/events/query', 'post', 'aggregate'),
    },
    response: { status: 200, body: aggregate },
    output: aggregate,
  },
  listSessions: {
    input: {
      query: { from: '2026-10-09T00:00:00Z', label: ['ticket=ABC-123', 'env=dev'], limit: 2 },
    },
    request: {
      method: 'GET',
      url: '/api/v1/sessions?from=2026-10-09T00%3A00%3A00Z&label=ticket%3DABC-123&label=env%3Ddev&limit=2',
    },
    response: { status: 200, body: { items: [session], next_cursor: null } },
    output: { items: [session], next_cursor: null },
  },
  getSession: {
    input: { path: { session_id: session.id } },
    request: { method: 'GET', url: `/api/v1/sessions/${session.id}` },
    response: { status: 200, body: { ...session, children: [] } },
    output: { ...session, children: [] },
  },
  putSessionLabels: {
    input: {
      path: { session_id: session.id },
      body: requestExample('/api/v1/sessions/{session_id}/labels', 'put'),
    },
    request: {
      method: 'PUT',
      url: `/api/v1/sessions/${session.id}/labels`,
      body: requestExample('/api/v1/sessions/{session_id}/labels', 'put'),
    },
    response: { status: 200, body: { session_id: session.id, labels: session.labels } },
    output: { session_id: session.id, labels: session.labels },
  },
  getInventory: {
    input: {},
    request: { method: 'GET', url: '/api/v1/inventory' },
    response: {
      status: 200,
      body: {
        owners: [{ id: 'u1', kind: 'user', name: 'Me' }],
        sources: [],
        accounts: [],
        services: ['claude-code'],
        models: [],
        metrics: [],
        events: [],
        attributes: [],
      },
    },
    output: {
      owners: [{ id: 'u1', kind: 'user', name: 'Me' }],
      sources: [],
      accounts: [],
      services: ['claude-code'],
      models: [],
      metrics: [],
      events: [],
      attributes: [],
    },
  },
  runSql: {
    input: { body: requestExample('/api/v1/sql', 'post') },
    request: { method: 'POST', url: '/api/v1/sql', body: requestExample('/api/v1/sql', 'post') },
    response: {
      status: 200,
      body: { columns: [{ name: 'model', type: 'text' }], rows: [['m']], truncated: false },
    },
    output: { columns: [{ name: 'model', type: 'text' }], rows: [['m']], truncated: false },
  },
  listStoreDocuments: {
    input: { path: { namespace: 'embertrail-dashboard' }, query: { cursor: 'c2', limit: 50 } },
    request: { method: 'GET', url: '/api/v1/store/embertrail-dashboard?cursor=c2&limit=50' },
    response: { status: 200, body: { items: [document], next_cursor: null } },
    output: { items: [document], next_cursor: null },
  },
  getStoreDocument: {
    input: { path: { namespace: 'embertrail-dashboard', id: 'overview' } },
    request: { method: 'GET', url: '/api/v1/store/embertrail-dashboard/overview' },
    response: { status: 200, headers: { etag: '"3"' }, body: document },
    output: { data: document, headers: { ETag: '"3"' } },
  },
  putStoreDocument: {
    input: {
      path: { namespace: 'embertrail-dashboard', id: 'overview' },
      header: { 'If-Match': '"3"' },
      body: { data: { widgets: [] } },
    },
    request: {
      method: 'PUT',
      url: '/api/v1/store/embertrail-dashboard/overview',
      body: { data: { widgets: [] } },
      headers: { 'if-match': '"3"' },
    },
    response: { status: 200, headers: { etag: '"4"' }, body: { ...document, version: 4 } },
    output: { data: { ...document, version: 4 }, headers: { ETag: '"4"' } },
  },
  deleteStoreDocument: {
    input: { path: { namespace: 'embertrail-dashboard', id: 'overview' } },
    request: { method: 'DELETE', url: '/api/v1/store/embertrail-dashboard/overview' },
    response: { status: 204 },
    output: undefined,
  },
  getOpenApi: {
    input: {},
    request: { method: 'GET', url: '/api/v1/openapi.json' },
    response: { status: 200, body: { openapi: '3.1.0' } },
    output: { openapi: '3.1.0' },
  },
}

describe('every operation', () => {
  const entries = Object.entries(cases) as [OperationId, Case<OperationId>][]

  it.each(entries)('%s sends the request the spec describes', async (id, testCase) => {
    hub.respond(testCase.response)
    const call = client[id] as (input: unknown) => Promise<unknown>

    await expect(call(testCase.input)).resolves.toEqual(testCase.output)

    expect(hub.requests).toHaveLength(1)
    const [received] = hub.requests
    expect(received).toMatchObject({
      method: testCase.request.method,
      url: testCase.request.url,
      body: testCase.request.body,
      headers: { authorization: 'Bearer et_test_secret', ...testCase.request.headers },
    })
  })
})

describe('createClient', () => {
  it('sends shared headers and no Authorization without a Token', async () => {
    const edge = createClient({
      baseUrl: `${hub.baseUrl}/`,
      headers: { 'cf-access-jwt-assertion': 'jwt' },
    })
    hub.respond({ status: 200, body: { openapi: '3.1.0' } })

    await edge.getOpenApi()

    expect(hub.requests[0]?.url).toBe('/api/v1/openapi.json')
    expect(hub.requests[0]?.headers['cf-access-jwt-assertion']).toBe('jwt')
    expect(hub.requests[0]?.headers.authorization).toBeUndefined()
  })

  it('encodes path parameters', async () => {
    hub.respond({ status: 200, body: { ...session, children: [] } })

    await client.getSession({ path: { session_id: 'a/b c' } })

    expect(hub.requests[0]?.url).toBe('/api/v1/sessions/a%2Fb%20c')
  })

  it('calls the fetch it is given, as a plain function', async () => {
    const calls: string[] = []
    const custom = createClient({
      baseUrl: 'https://hub.example',
      fetch: function (this: unknown, input) {
        expect(this).toBeUndefined()
        expect(typeof input).toBe('string')
        calls.push(input as string)
        return Promise.resolve(Response.json({ openapi: '3.1.0' }))
      },
    })

    await expect(custom.getOpenApi()).resolves.toEqual({ openapi: '3.1.0' })
    expect(calls).toEqual(['https://hub.example/api/v1/openapi.json'])
  })

  it('passes the abort signal through', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(client.getOpenApi({ signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
})
