import { testHub } from '@mitcsutt/embertrail-hub/testing'
import type { TestClient, TestHub } from '@mitcsutt/embertrail-hub/testing'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { otel } from '../module'
import { postOtlp } from '../testing'
import { assertProblem, assertSpecResponse, seedSession } from './testing/support'

type Value = string | number | boolean

interface Point {
  time: string
  value: number
  attributes?: Record<string, Value>
}

const nanos = (iso: string) => String(BigInt(Date.parse(iso)) * 1_000_000n)

const otlpValue = (v: Value) =>
  typeof v === 'string'
    ? { stringValue: v }
    : typeof v === 'boolean'
      ? { boolValue: v }
      : Number.isInteger(v)
        ? { intValue: v }
        : { doubleValue: v }

const keyValues = (attributes: Record<string, Value>) =>
  Object.entries(attributes).map(([key, value]) => ({ key, value: otlpValue(value) }))

/** One delta sum with these points, from a `test` service. */
function sumOf(name: string, points: readonly Point[], resource: Record<string, Value> = {}) {
  return {
    resourceMetrics: [
      {
        resource: { attributes: keyValues({ 'service.name': 'test', ...resource }) },
        scopeMetrics: [
          {
            scope: { name: 'test' },
            metrics: [
              {
                name,
                unit: '1',
                sum: {
                  aggregationTemporality: 1,
                  isMonotonic: true,
                  dataPoints: points.map((p) => ({
                    attributes: keyValues(p.attributes ?? {}),
                    startTimeUnixNano: nanos(p.time),
                    timeUnixNano: nanos(p.time),
                    asDouble: p.value,
                  })),
                },
              },
            ],
          },
        ],
      },
    ],
  }
}

/** Events with these attributes, from a `test` service. */
function eventsOf(records: readonly { time: string; attributes: Record<string, Value> }[]) {
  return {
    resourceLogs: [
      {
        resource: { attributes: keyValues({ 'service.name': 'test' }) },
        scopeLogs: [
          {
            scope: { name: 'test' },
            logRecords: records.map((r) => ({
              timeUnixNano: nanos(r.time),
              attributes: keyValues(r.attributes),
            })),
          },
        ],
      },
    ],
  }
}

async function ok(client: TestClient, path: string, body: unknown) {
  const response = await postOtlp(client, path, body)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({})
}

/** Calls an endpoint, checks the status and validates the body against the spec. */
async function call(
  response: Promise<Response>,
  path: string,
  method: 'get' | 'post' | 'put',
  status = 200,
) {
  const answered = await response
  const body: unknown = await answered.json()
  expect(answered.status, JSON.stringify(body)).toBe(status)
  if (status === 200) assertSpecResponse(path, method, status, body)
  return body as Record<string, unknown> & { rows: Row[]; items: Record<string, unknown>[] }
}

interface Row {
  bucket?: string
  group: Record<string, unknown>
  value: number | null
}

const window = { from: '2026-10-01T00:00:00Z', to: '2026-12-01T00:00:00Z' }

let t: TestHub
let ingest: TestClient
let alice: TestClient

beforeEach(async () => {
  t = await testHub({ modules: [otel] })
  ingest = t.as('alice', ['otel:write'], { sourceId: 'laptop' })
  alice = t.as('alice', ['otel:read', 'otel:write'])
})

afterEach(async () => {
  const { errors } = t
  await t.close()
  if (errors.length > 0) throw new Error(`The Hub answered with a 500: ${String(errors[0])}`)
})

const metrics = (client: TestClient, query: Record<string, unknown>) =>
  call(
    client.post('/api/v1/metrics/query', { aggregation: 'sum', ...window, ...query }),
    '/api/v1/metrics/query',
    'post',
  )

const events = (client: TestClient, query: Record<string, unknown>, status = 200) =>
  call(
    client.post('/api/v1/events/query', { ...window, tz: 'UTC', ...query }),
    '/api/v1/events/query',
    'post',
    status,
  )

describe('bucketing', () => {
  it('starts each day at local midnight across the end of DST in Europe/Berlin', async () => {
    // Berlin leaves summer time at 03:00 CEST on Sunday 2026-10-25, so that day lasts 25 hours.
    await ok(
      ingest,
      '/v1/metrics',
      sumOf('m', [
        { time: '2026-10-24T21:59:00Z', value: 1 }, // 23:59 CEST, the 24th
        { time: '2026-10-24T22:00:00Z', value: 2 }, // 00:00 CEST, the 25th
        { time: '2026-10-25T22:59:00Z', value: 4 }, // 23:59 CET, still the 25th
        { time: '2026-10-25T23:00:00Z', value: 8 }, // 00:00 CET, the 26th
      ]),
    )
    const { rows } = await metrics(alice, { metric: 'm', tz: 'Europe/Berlin', bucket: 'day' })
    expect(rows).toEqual([
      { bucket: '2026-10-24T00:00:00+02:00', group: {}, value: 1 },
      { bucket: '2026-10-25T00:00:00+02:00', group: {}, value: 6 },
      { bucket: '2026-10-26T00:00:00+01:00', group: {}, value: 8 },
    ])
  })

  it('starts each day at local midnight across the end of DST in America/New_York', async () => {
    // New York leaves daylight time at 02:00 EDT on Sunday 2026-11-01.
    await ok(
      ingest,
      '/v1/metrics',
      sumOf('m', [
        { time: '2026-11-01T03:59:00Z', value: 1 }, // 23:59 EDT, Oct 31
        { time: '2026-11-01T04:00:00Z', value: 2 }, // 00:00 EDT, Nov 1
        { time: '2026-11-02T04:59:00Z', value: 4 }, // 23:59 EST, still Nov 1
        { time: '2026-11-02T05:00:00Z', value: 8 }, // 00:00 EST, Nov 2
      ]),
    )
    const { rows } = await metrics(alice, { metric: 'm', tz: 'America/New_York', bucket: 'day' })
    expect(rows).toEqual([
      { bucket: '2026-10-31T00:00:00-04:00', group: {}, value: 1 },
      { bucket: '2026-11-01T00:00:00-04:00', group: {}, value: 6 },
      { bucket: '2026-11-02T00:00:00-05:00', group: {}, value: 8 },
    ])
  })

  it('counts a fall-back hour twice in hourly buckets, each with its own offset', async () => {
    await ok(
      ingest,
      '/v1/metrics',
      sumOf('m', [
        { time: '2026-10-25T00:30:00Z', value: 1 }, // 02:30 CEST
        { time: '2026-10-25T01:30:00Z', value: 2 }, // 02:30 CET
      ]),
    )
    const { rows } = await metrics(alice, { metric: 'm', tz: 'Europe/Berlin', bucket: 'hour' })
    expect(rows.map((r) => [r.bucket, r.value])).toEqual([
      ['2026-10-25T02:00:00+02:00', 1],
      ['2026-10-25T02:00:00+01:00', 2],
    ])
  })

  it('starts weeks on Monday in the zone, in two zones', async () => {
    await ok(
      ingest,
      '/v1/metrics',
      sumOf('m', [
        { time: '2026-10-18T21:59:00Z', value: 1 }, // Sunday 23:59 in Berlin, Monday 07:59 in Tokyo
        { time: '2026-10-18T22:00:00Z', value: 2 }, // Monday 00:00 in Berlin
        { time: '2026-10-25T23:30:00Z', value: 4 }, // Monday 00:30 CET, after the change
      ]),
    )
    const berlin = await metrics(alice, { metric: 'm', tz: 'Europe/Berlin', bucket: 'week' })
    expect(berlin.rows).toEqual([
      { bucket: '2026-10-12T00:00:00+02:00', group: {}, value: 1 },
      { bucket: '2026-10-19T00:00:00+02:00', group: {}, value: 2 },
      { bucket: '2026-10-26T00:00:00+01:00', group: {}, value: 4 },
    ])
    const tokyo = await metrics(alice, { metric: 'm', tz: 'Asia/Tokyo', bucket: 'week' })
    expect(tokyo.rows).toEqual([
      { bucket: '2026-10-19T00:00:00+09:00', group: {}, value: 3 },
      { bucket: '2026-10-26T00:00:00+09:00', group: {}, value: 4 },
    ])
  })

  it('buckets months and minutes, omits empty buckets, and refuses an unknown zone', async () => {
    await ok(
      ingest,
      '/v1/metrics',
      sumOf('m', [
        { time: '2026-10-31T23:30:00Z', value: 1 }, // November in Berlin
        { time: '2026-10-01T10:00:30Z', value: 2 },
        { time: '2026-10-01T10:00:50Z', value: 3 },
        { time: '2026-10-01T10:05:00Z', value: 4 },
      ]),
    )
    const months = await metrics(alice, { metric: 'm', tz: 'Europe/Berlin', bucket: 'month' })
    expect(months.rows.map((r) => [r.bucket, r.value])).toEqual([
      ['2026-10-01T00:00:00+02:00', 9],
      ['2026-11-01T00:00:00+01:00', 1],
    ])
    const minutes = await metrics(alice, { metric: 'm', tz: 'UTC', bucket: 'minute' })
    expect(minutes.rows.map((r) => [r.bucket, r.value])).toEqual([
      ['2026-10-01T10:00:00Z', 5],
      ['2026-10-01T10:05:00Z', 4],
      ['2026-10-31T23:30:00Z', 1],
    ])
    const refused = await alice.post('/api/v1/metrics/query', {
      metric: 'm',
      aggregation: 'sum',
      ...window,
      tz: 'Mars/Olympus',
    })
    expect(refused.status).toBe(422)
    assertProblem(await refused.json(), 'invalid')
  })
})

describe('metrics', () => {
  it('aggregates, groups on columns and attributes, filters, and orders top-N', async () => {
    await ok(
      ingest,
      '/v1/metrics',
      sumOf('m', [
        { time: '2026-10-02T10:00:00Z', value: 1, attributes: { model: 'a', tool: 'Edit' } },
        { time: '2026-10-02T11:00:00Z', value: 5, attributes: { model: 'a', tool: 'Bash' } },
        { time: '2026-10-02T12:00:00Z', value: 3, attributes: { model: 'b', tool: 'Edit' } },
        { time: '2026-10-03T12:00:00Z', value: 7, attributes: { model: 'b' } },
      ]),
    )
    const total = await metrics(alice, { metric: 'm', tz: 'UTC' })
    expect(total.rows).toEqual([{ group: {}, value: 16 }])
    expect(total.meta).toEqual({ tz: 'UTC', unit: '1' })

    const byBoth = await metrics(alice, { metric: 'm', tz: 'UTC', group_by: ['model', 'tool'] })
    expect(byBoth.rows).toEqual([
      { group: { model: 'a', tool: 'Bash' }, value: 5 },
      { group: { model: 'a', tool: 'Edit' }, value: 1 },
      { group: { model: 'b', tool: 'Edit' }, value: 3 },
      { group: { model: 'b', tool: null }, value: 7 },
    ])

    const top = await metrics(alice, {
      metric: 'm',
      tz: 'UTC',
      group_by: ['tool'],
      order: { by: 'value', direction: 'desc' },
      limit: 1,
    })
    expect(top.rows).toEqual([{ group: { tool: null }, value: 7 }])

    const filtered = await metrics(alice, {
      metric: 'm',
      tz: 'UTC',
      aggregation: 'count',
      filter: [
        { key: 'tool', op: 'in', value: ['Edit', 'Bash'] },
        { key: 'model', op: 'neq', value: 'b' },
      ],
    })
    expect(filtered.rows).toEqual([{ group: {}, value: 2 }])

    const absent = await metrics(alice, {
      metric: 'm',
      tz: 'UTC',
      filter: [{ key: 'tool', op: 'not_exists' }],
    })
    expect(absent.rows).toEqual([{ group: {}, value: 7 }])

    for (const [aggregation, value] of [
      ['avg', 4],
      ['min', 1],
      ['max', 7],
      ['last', 7],
    ] as const) {
      const found = await metrics(alice, { metric: 'm', tz: 'UTC', aggregation })
      expect(found.rows).toEqual([{ group: {}, value }])
    }

    const none = await metrics(alice, { metric: 'nothing', tz: 'UTC' })
    expect(none).toEqual({ rows: [], meta: { tz: 'UTC', unit: null } })
  })
})

describe('events', () => {
  const records: { time: string; attributes: Record<string, Value> }[] = [
    {
      time: '2026-10-02T10:00:00Z',
      attributes: {
        'event.name': 'api_request',
        model: 'a',
        duration_ms: 100,
        'session.id': 's',
        'event.sequence': 1,
      },
    },
    {
      time: '2026-10-02T10:10:00Z',
      attributes: {
        'event.name': 'api_request',
        model: 'a',
        duration_ms: 200,
        'session.id': 's',
        'event.sequence': 2,
      },
    },
    {
      time: '2026-10-02T10:20:00Z',
      attributes: {
        'event.name': 'api_request',
        model: 'b',
        duration_ms: 'slow',
        'session.id': 's',
        'event.sequence': 3,
      },
    },
    {
      time: '2026-10-02T11:00:00Z',
      attributes: {
        'event.name': 'tool_result',
        tool_name: 'Edit',
        success: 'true',
        'session.id': 's',
        'event.sequence': 4,
      },
    },
    {
      time: '2026-10-02T11:00:00Z',
      attributes: {
        'event.name': 'tool_result',
        tool_name: 'Bash',
        success: 'false',
        'session.id': 's',
        'event.sequence': 5,
      },
    },
  ]

  it('lists Events newest first, then by sequence, with a cursor tied to the query', async () => {
    await ok(ingest, '/v1/logs', eventsOf(records))
    const first = await events(alice, { mode: 'list', limit: 2 })
    expect(first.items.map((e) => e.sequence)).toEqual([5, 4])
    expect(typeof first.next_cursor).toBe('string')
    const second = await events(alice, { mode: 'list', limit: 2, cursor: first.next_cursor })
    expect(second.items.map((e) => e.sequence)).toEqual([3, 2])
    const last = await events(alice, { mode: 'list', limit: 2, cursor: second.next_cursor })
    expect(last.items.map((e) => e.sequence)).toEqual([1])
    expect(last.next_cursor).toBeNull()

    const ascending = await events(alice, {
      mode: 'list',
      order: 'asc',
      filter: [{ key: 'event.name', op: 'eq', value: 'tool_result' }],
    })
    expect(ascending.items.map((e) => e.sequence)).toEqual([4, 5])

    const other = await alice.post('/api/v1/events/query', {
      mode: 'list',
      ...window,
      tz: 'UTC',
      order: 'asc',
      cursor: first.next_cursor,
    })
    expect(other.status).toBe(400)
    assertProblem(await other.json(), 'invalid-cursor')
  })

  it('aggregates count, count_distinct and percentiles, ignoring non-numeric values', async () => {
    await ok(ingest, '/v1/logs', eventsOf(records))
    const requests = [{ key: 'event.name', op: 'eq', value: 'api_request' }]
    const p50 = await events(alice, {
      mode: 'aggregate',
      filter: requests,
      aggregation: { fn: 'p50', key: 'duration_ms' },
    })
    expect(p50.rows).toEqual([{ group: {}, value: 150 }])
    const byModel = await events(alice, {
      mode: 'aggregate',
      filter: requests,
      aggregation: { fn: 'p95', key: 'duration_ms' },
      bucket: 'hour',
      group_by: ['model'],
    })
    expect(byModel.rows).toEqual([
      { bucket: '2026-10-02T10:00:00Z', group: { model: 'a' }, value: 195 },
      { bucket: '2026-10-02T10:00:00Z', group: { model: 'b' }, value: null },
    ])
    const distinct = await events(alice, {
      mode: 'aggregate',
      aggregation: { fn: 'count_distinct', key: 'model' },
    })
    expect(distinct.rows).toEqual([{ group: {}, value: 2 }])
    const tools = await events(alice, {
      mode: 'aggregate',
      filter: [{ key: 'event.name', op: 'eq', value: 'tool_result' }],
      aggregation: { fn: 'count' },
      group_by: ['tool_name', 'success'],
    })
    expect(tools.rows).toEqual([
      { group: { tool_name: 'Bash', success: 'false' }, value: 1 },
      { group: { tool_name: 'Edit', success: 'true' }, value: 1 },
    ])
    const ordered = await events(alice, {
      mode: 'aggregate',
      aggregation: { fn: 'sum', key: 'event.sequence' },
      filter: [{ key: 'event.sequence', op: 'gte', value: 2 }],
    })
    expect(ordered.rows).toEqual([{ group: {}, value: 14 }])

    const missingKey = await events(alice, { mode: 'aggregate', aggregation: { fn: 'sum' } }, 400)
    assertProblem(missingKey, 'validation')
  })
})

describe('limits', () => {
  it('takes group_by of 3 and refuses 4', async () => {
    const query = { metric: 'm', aggregation: 'sum', ...window, tz: 'UTC' }
    const three = await alice.post('/api/v1/metrics/query', { ...query, group_by: ['a', 'b', 'c'] })
    expect(three.status).toBe(200)
    assertSpecResponse('/api/v1/metrics/query', 'post', 200, await three.json())
    const four = await alice.post('/api/v1/metrics/query', {
      ...query,
      group_by: ['a', 'b', 'c', 'd'],
    })
    expect(four.status).toBe(400)
    const problem = await four.json()
    assertProblem(problem, 'validation')
    expect(problem).toMatchObject({ errors: [{ pointer: '/group_by' }] })
  })

  it('returns 10,000 aggregate rows and refuses 10,001 with too-many-rows', async () => {
    const points = Array.from({ length: 10_001 }, (_, n) => ({
      time: '2026-10-02T10:00:00Z',
      value: 1,
      attributes: { n },
    }))
    await ok(ingest, '/v1/metrics', sumOf('wide', points))
    const query = { metric: 'wide', aggregation: 'sum', ...window, tz: 'UTC', group_by: ['n'] }
    const atLimit = await metrics(alice, {
      ...query,
      filter: [{ key: 'n', op: 'lt', value: 10_000 }],
    })
    expect(atLimit.rows).toHaveLength(10_000)
    const over = await alice.post('/api/v1/metrics/query', query)
    expect(over.status).toBe(422)
    assertProblem(await over.json(), 'too-many-rows')
    const overEvents = await alice.post('/api/v1/events/query', {
      ...window,
      tz: 'UTC',
      mode: 'aggregate',
      aggregation: { fn: 'count' },
      group_by: ['embertrail.owner_id'],
      limit: 10_001,
    })
    expect(overEvents.status).toBe(400)
    // A top-N within the cap is fine even when the full result is over it.
    const top = await metrics(alice, { ...query, limit: 10_000 })
    expect(top.rows).toHaveLength(10_000)
  })

  it('pages up to 1,000 Events or Sessions and refuses a limit of 1,001', async () => {
    const list = { mode: 'list', ...window, tz: 'UTC' }
    expect((await alice.post('/api/v1/events/query', { ...list, limit: 1000 })).status).toBe(200)
    const events = await alice.post('/api/v1/events/query', { ...list, limit: 1001 })
    expect(events.status).toBe(400)
    assertProblem(await events.json(), 'validation')
    await call(alice.get('/api/v1/sessions?limit=1000'), '/api/v1/sessions', 'get')
    const sessions = await alice.get('/api/v1/sessions?limit=1001')
    expect(sessions.status).toBe(400)
    assertProblem(await sessions.json(), 'validation')
  })
})

describe('Sessions and Labels', () => {
  it('summarises a Claude Code Session from its Signals', async () => {
    await seedSession(ingest, { sessionId: 's1', start: new Date('2026-10-12T09:00:00Z') })
    const { items, next_cursor } = await call(
      alice.get('/api/v1/sessions'),
      '/api/v1/sessions',
      'get',
    )
    expect(next_cursor).toBeNull()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 's1',
      service_name: 'claude-code',
      owner_id: 'alice',
      source_id: 'laptop',
      started_at: '2026-10-12T09:00:00.003000Z',
      models: ['claude-haiku-4-5', 'claude-opus-4-7'],
      tokens: { input: 825, output: 997, cacheRead: 98357, cacheCreation: 3800 },
      event_counts: expect.objectContaining({ api_request: 4, tool_result: 6 }) as unknown,
      group: null,
      parent_session_id: null,
      role: null,
      labels: {},
    })
    expect(items[0]?.cost_usd).toBeCloseTo(0.0922014, 7)
  })

  it('accepts Labels before any Signal, and the Session appears without a range', async () => {
    const labels = { 'embertrail.group.id': 'batch-1', ticket: 'ABC-123' }
    const put = await call(
      alice.put('/api/v1/sessions/later/labels', { labels }),
      '/api/v1/sessions/{session_id}/labels',
      'put',
    )
    expect(put).toEqual({ session_id: 'later', labels })
    const { items } = await call(alice.get('/api/v1/sessions'), '/api/v1/sessions', 'get')
    expect(items).toEqual([
      expect.objectContaining({
        id: 'later',
        service_name: null,
        started_at: null,
        group: { id: 'batch-1', kind: null },
        labels,
      }),
    ])
    const ranged = await call(
      alice.get(`/api/v1/sessions?from=${window.from}&to=${window.to}`),
      '/api/v1/sessions',
      'get',
    )
    expect(ranged.items).toEqual([])

    await seedSession(ingest, { sessionId: 'later', start: new Date('2026-10-12T09:00:00Z') })
    const after = await call(
      alice.get('/api/v1/sessions/later'),
      '/api/v1/sessions/{session_id}',
      'get',
    )
    expect(after).toMatchObject({ id: 'later', service_name: 'claude-code', labels, children: [] })
  })

  it('lets reserved Labels override attributes in summaries, filters and group_by', async () => {
    const resource = { 'embertrail.group.id': 'from-attribute', 'embertrail.role': 'worker' }
    await seedSession(ingest, { sessionId: 'a', start: new Date('2026-10-12T09:00:00Z'), resource })
    await seedSession(ingest, { sessionId: 'b', start: new Date('2026-10-12T10:00:00Z'), resource })
    await call(
      alice.put('/api/v1/sessions/b/labels', {
        labels: { 'embertrail.group.id': 'from-label', 'embertrail.parent.session_id': 'a' },
      }),
      '/api/v1/sessions/{session_id}/labels',
      'put',
    )
    const b = await call(alice.get('/api/v1/sessions/b'), '/api/v1/sessions/{session_id}', 'get')
    expect(b).toMatchObject({ group: { id: 'from-label' }, role: 'worker', parent_session_id: 'a' })
    const a = await call(alice.get('/api/v1/sessions/a'), '/api/v1/sessions/{session_id}', 'get')
    expect(a).toMatchObject({ group: { id: 'from-attribute' } })
    expect((a.children as { id: string }[]).map((c) => c.id)).toEqual(['b'])

    const grouped = await metrics(alice, {
      metric: 'claude_code.session.count',
      tz: 'UTC',
      group_by: ['embertrail.group.id'],
    })
    expect(grouped.rows).toEqual([
      { group: { 'embertrail.group.id': 'from-attribute' }, value: 1 },
      { group: { 'embertrail.group.id': 'from-label' }, value: 1 },
    ])
    const filtered = await events(alice, {
      mode: 'aggregate',
      aggregation: { fn: 'count_distinct', key: 'session.id' },
      filter: [{ key: 'embertrail.group.id', op: 'eq', value: 'from-label' }],
    })
    expect(filtered.rows).toEqual([{ group: {}, value: 1 }])

    const inGroup = await call(
      alice.get('/api/v1/sessions?group_id=from-label'),
      '/api/v1/sessions',
      'get',
    )
    expect(inGroup.items.map((s) => s.id)).toEqual(['b'])
    const children = await call(
      alice.get('/api/v1/sessions?parent_session_id=a'),
      '/api/v1/sessions',
      'get',
    )
    expect(children.items.map((s) => s.id)).toEqual(['b'])
  })

  it('replaces the full Label set, and an empty set clears it', async () => {
    const path = '/api/v1/sessions/s/labels'
    const spec = '/api/v1/sessions/{session_id}/labels'
    await call(alice.put(path, { labels: { a: '1', b: '2' } }), spec, 'put')
    await call(alice.put(path, { labels: { c: '3' } }), spec, 'put')
    const replaced = await call(alice.get('/api/v1/sessions?label=c=3'), '/api/v1/sessions', 'get')
    expect(replaced.items.map((s) => s.labels)).toEqual([{ c: '3' }])
    const gone = await call(alice.get('/api/v1/sessions?label=a=1'), '/api/v1/sessions', 'get')
    expect(gone.items).toEqual([])
    await call(alice.put(path, { labels: {} }), spec, 'put')
    const cleared = await call(alice.get('/api/v1/sessions'), '/api/v1/sessions', 'get')
    expect(cleared.items).toEqual([])

    const bad = await alice.put(path, { labels: { 'not a key': 'x' } })
    expect(bad.status).toBe(400)
    const tooMany = await alice.put(path, {
      labels: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`k${String(i)}`, 'v'])),
    })
    expect(tooMany.status).toBe(400)
    const readOnly = await t.as('alice', ['otel:read']).put(path, { labels: { a: '1' } })
    expect(readOnly.status).toBe(403)
  })

  it('accepts Labels from a Source-bound ingest Token', async () => {
    const put = await ingest.put('/api/v1/sessions/s/labels', {
      labels: { 'embertrail.role': 'supervisor' },
    })
    expect(put.status).toBe(200)
    const { items } = await call(alice.get('/api/v1/sessions'), '/api/v1/sessions', 'get')
    expect(items).toEqual([expect.objectContaining({ id: 's', role: 'supervisor' })])
  })

  it('sorts, filters and pages Sessions', async () => {
    for (const [i, id] of ['s1', 's2', 's3'].entries()) {
      await seedSession(ingest, {
        sessionId: id,
        start: new Date(Date.UTC(2026, 9, 12 + i, 9)),
        fixtures: i === 1 ? ['logs-turn'] : ['logs-turn', 'metrics-second'],
      })
    }
    const ids = async (query: string) =>
      (await call(alice.get(`/api/v1/sessions${query}`), '/api/v1/sessions', 'get')).items.map(
        (s) => s.id,
      )
    expect(await ids('')).toEqual(['s3', 's2', 's1'])
    expect(await ids('?sort=started_at')).toEqual(['s1', 's2', 's3'])
    expect(await ids('?sort=-cost_usd')).toEqual(['s3', 's1', 's2'])
    expect(await ids('?from=2026-10-13T12:00:00Z')).toEqual(['s3'])
    expect(await ids('?to=2026-10-13T00:00:00Z')).toEqual(['s1'])
    expect(await ids('?model=claude-haiku-4-5')).toEqual(['s3', 's1'])
    expect(await ids('?source_id=laptop&service_name=claude-code')).toHaveLength(3)

    const first = await call(alice.get('/api/v1/sessions?limit=2'), '/api/v1/sessions', 'get')
    expect(first.items.map((s) => s.id)).toEqual(['s3', 's2'])
    const cursor = encodeURIComponent(String(first.next_cursor))
    const second = await call(
      alice.get(`/api/v1/sessions?limit=2&cursor=${cursor}`),
      '/api/v1/sessions',
      'get',
    )
    expect(second.items.map((s) => s.id)).toEqual(['s1'])
    expect(second.next_cursor).toBeNull()
    const elsewhere = await alice.get(`/api/v1/sessions?sort=started_at&cursor=${cursor}`)
    expect(elsewhere.status).toBe(400)
    assertProblem(await elsewhere.json(), 'invalid-cursor')

    const missing = await alice.get('/api/v1/sessions/nope')
    expect(missing.status).toBe(404)
    assertProblem(await missing.json(), 'not-found')
  })
})

describe('Inventory', () => {
  it('lists what exists in the visible data', async () => {
    await seedSession(ingest, { sessionId: 's1', start: new Date('2026-10-12T09:00:00Z') })
    const body = await call(alice.get('/api/v1/inventory'), '/api/v1/inventory', 'get')
    expect(body).toMatchObject({
      owners: [{ id: 'alice', kind: 'user', name: 'alice' }],
      sources: [{ id: 'laptop', name: 'laptop', owner_id: 'alice' }],
      accounts: [expect.objectContaining({ owner_id: 'alice', label: 'example.com' })],
      services: ['claude-code'],
      models: ['claude-haiku-4-5', 'claude-opus-4-7'],
    })
    expect(body.metrics).toContainEqual({
      name: 'claude_code.cost.usage',
      kind: 'sum',
      unit: 'USD',
      service_name: 'claude-code',
    })
    expect(body.events).toContainEqual({ name: 'api_request', service_name: 'claude-code' })
    const keys = body.attributes as { signal: string; key: string; promoted: boolean }[]
    expect(keys).toContainEqual({ signal: 'event', key: 'session.id', promoted: true })
    expect(keys).toContainEqual({ signal: 'event', key: 'duration_ms', promoted: false })
    expect(keys).toContainEqual({ signal: 'metric', key: 'type', promoted: true })

    const empty = await call(
      alice.get('/api/v1/inventory?from=2025-01-01T00:00:00Z&to=2025-02-01T00:00:00Z'),
      '/api/v1/inventory',
      'get',
    )
    expect(empty).toMatchObject({
      sources: [],
      accounts: [],
      metrics: [],
      events: [],
      attributes: [],
    })
  })
})

describe('a Grant-less second User', () => {
  it("sees none of the first User's rows on any endpoint", async () => {
    await seedSession(ingest, {
      sessionId: 's1',
      start: new Date('2026-10-12T09:00:00Z'),
      resource: { 'embertrail.group.id': 'g' },
    })
    await call(
      alice.put('/api/v1/sessions/s1/labels', { labels: { mine: 'yes' } }),
      '/api/v1/sessions/{session_id}/labels',
      'put',
    )
    await call(
      alice.put('/api/v1/sessions/labels-only/labels', { labels: { mine: 'yes' } }),
      '/api/v1/sessions/{session_id}/labels',
      'put',
    )
    const bob = t.as('bob', ['otel:read', 'otel:write'])

    expect((await metrics(bob, { metric: 'claude_code.cost.usage', tz: 'UTC' })).rows).toEqual([])
    expect((await events(bob, { mode: 'list' })).items).toEqual([])
    expect((await events(bob, { mode: 'aggregate', aggregation: { fn: 'count' } })).rows).toEqual(
      [],
    )
    expect((await call(bob.get('/api/v1/sessions'), '/api/v1/sessions', 'get')).items).toEqual([])
    expect((await bob.get('/api/v1/sessions/s1')).status).toBe(404)
    expect((await bob.get('/api/v1/sessions/labels-only')).status).toBe(404)
    const inventory = await call(bob.get('/api/v1/inventory'), '/api/v1/inventory', 'get')
    expect(inventory).toEqual({
      owners: [{ id: 'bob', kind: 'user', name: 'bob' }],
      sources: [],
      accounts: [],
      services: [],
      models: [],
      metrics: [],
      events: [],
      attributes: [],
    })

    // Bob's own Labels on the same Session id stay his, and never touch Alice's.
    await call(
      bob.put('/api/v1/sessions/s1/labels', { labels: { 'embertrail.group.id': 'bobs' } }),
      '/api/v1/sessions/{session_id}/labels',
      'put',
    )
    const grouped = await metrics(alice, {
      metric: 'claude_code.session.count',
      tz: 'UTC',
      group_by: ['embertrail.group.id'],
    })
    expect(grouped.rows).toEqual([{ group: { 'embertrail.group.id': 'g' }, value: 1 }])
    const own = await call(alice.get('/api/v1/sessions/s1'), '/api/v1/sessions/{session_id}', 'get')
    expect(own).toMatchObject({ labels: { mine: 'yes' }, group: { id: 'g' } })
    const bobs = await call(bob.get('/api/v1/sessions'), '/api/v1/sessions', 'get')
    expect(bobs.items).toEqual([
      expect.objectContaining({ id: 's1', owner_id: 'bob', service_name: null }),
    ])
  })
})
