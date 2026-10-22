import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { startMockHub, type MockHub } from '../test/mock-hub.ts'

import { createClient, items, pages, type EmbertrailClient, type Schemas } from './index.ts'

let hub: MockHub
let client: EmbertrailClient

beforeAll(async () => {
  hub = await startMockHub()
  client = createClient({ baseUrl: hub.baseUrl })
})
afterAll(() => hub.close())
beforeEach(() => {
  hub.requests.length = 0
})

const document = (id: string): Schemas['StoreDocument'] => ({
  namespace: 'notes',
  id,
  owner: { kind: 'user', id: 'u1' },
  version: 1,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  data: null,
})

describe('items', () => {
  it('follows next_cursor across pages, passing each cursor back', async () => {
    hub.respond(
      { status: 200, body: { items: [document('a'), document('b')], next_cursor: 'c1' } },
      { status: 200, body: { items: [document('c')], next_cursor: 'c2' } },
      { status: 200, body: { items: [], next_cursor: null } },
    )

    const ids: string[] = []
    for await (const item of items((cursor) =>
      client.listStoreDocuments({ path: { namespace: 'notes' }, query: { cursor, limit: 2 } }),
    )) {
      ids.push(item.id)
    }

    expect(ids).toEqual(['a', 'b', 'c'])
    expect(hub.requests.map((request) => request.url)).toEqual([
      '/api/v1/store/notes?limit=2',
      '/api/v1/store/notes?cursor=c1&limit=2',
      '/api/v1/store/notes?cursor=c2&limit=2',
    ])
  })

  it('pages Events through the cursor in the request body', async () => {
    const event: Schemas['Event'] = {
      time: '2026-10-09T08:00:00Z',
      event_name: 'api_request',
      sequence: null,
      session_id: null,
      prompt_id: null,
      request_id: null,
      model: null,
      body: null,
      service_name: 'claude-code',
      owner_id: 'u1',
      source_id: 's1',
      account_id: 'a1',
      attributes: {},
      resource: {},
    }
    hub.respond(
      { status: 200, body: { items: [event], next_cursor: 'e1' } },
      { status: 200, body: { items: [event], next_cursor: null } },
    )
    const query = {
      mode: 'list',
      from: '2026-10-09T00:00:00Z',
      to: '2026-10-10T00:00:00Z',
      tz: 'UTC',
    } as const

    const events: Schemas['Event'][] = []
    for await (const item of items(async (cursor) => {
      const result = await client.queryEvents({ body: { ...query, cursor } })
      if (!('items' in result)) throw new Error('expected an Event list')
      return result
    })) {
      events.push(item)
    }

    expect(events).toHaveLength(2)
    expect(hub.requests.map((request) => request.body)).toEqual([query, { ...query, cursor: 'e1' }])
  })
})

describe('pages', () => {
  it('stops after a single page whose next_cursor is null', async () => {
    hub.respond({ status: 200, body: { items: [document('a')], next_cursor: null } })

    const seen = []
    for await (const page of pages((cursor) =>
      client.listStoreDocuments({ path: { namespace: 'notes' }, query: { cursor } }),
    )) {
      seen.push(page)
    }

    expect(seen).toEqual([{ items: [document('a')], next_cursor: null }])
  })
})
