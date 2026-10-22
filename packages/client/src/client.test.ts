import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { startMockHub, type MockHub } from '../test/mock-hub.ts'

import { createClient, type EmbertrailClient, type Schemas } from './index.ts'

// What each operation sends and returns is covered against the real Hub in integration.test.ts;
// this file covers the client's own transport behaviour with a stand-in Hub.

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
