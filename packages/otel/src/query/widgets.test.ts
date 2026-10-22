// The 20 curated Widgets (#16) each run as one Query API call against a month of one User's
// Claude Code Sessions on PGLite, each under 500 ms (#33), and answer what the spec says.

import { testHub } from '@mitcsutt/embertrail-hub/testing'
import type { TestClient, TestHub } from '@mitcsutt/embertrail-hub/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { otel } from '../module'
import { assertSpecResponse, seedSession } from './testing/support'

const budgetMs = 500
const days = 30
const sessionsPerDay = 3
const tz = 'Europe/Berlin'

/** "Now": the morning after the seeded month. */
const now = new Date('2026-11-01T08:00:00Z')
const today = { from: '2026-11-01T00:00:00+01:00', to: '2026-11-02T00:00:00+01:00' }
const thisWeek = { from: '2026-10-26T00:00:00+01:00', to: '2026-11-02T00:00:00+01:00' }
const month = { from: '2026-10-02T00:00:00+02:00', to: '2026-11-02T00:00:00+01:00' }
const last28Days = { from: '2026-10-05T00:00:00+02:00', to: '2026-11-02T00:00:00+01:00' }
const last12Weeks = { from: '2026-08-10T00:00:00+02:00', to: '2026-11-02T00:00:00+01:00' }

const metric = (name: string, window: { from: string; to: string }, rest = {}) => ({
  path: '/api/v1/metrics/query',
  body: { metric: `claude_code.${name}`, aggregation: 'sum', ...window, tz, ...rest },
})

const event = (name: string, aggregation: object, rest = {}) => ({
  path: '/api/v1/events/query',
  body: {
    mode: 'aggregate',
    ...month,
    tz,
    filter: [{ key: 'event.name', op: 'eq', value: name }],
    aggregation,
    ...rest,
  },
})

/** #16's catalogue, in its order. */
const widgets: [string, { path: string; body?: object }][] = [
  ['Cost today', metric('cost.usage', today)],
  ['Cost this week', metric('cost.usage', thisWeek)],
  ['Each day by model', metric('cost.usage', month, { bucket: 'day', group_by: ['model'] })],
  ['Cost by Account', metric('cost.usage', month, { group_by: ['embertrail.account_id'] })],
  ['Sessions today', metric('session.count', today)],
  ['Top sessions', { path: '/api/v1/sessions?sort=-cost_usd&limit=10' }],
  ['Sessions per day', metric('session.count', month, { bucket: 'day', group_by: ['start_type'] })],
  ['Model mix', metric('cost.usage', month, { group_by: ['model'] })],
  ['Cache share', metric('token.usage', month, { group_by: ['type'] })],
  ['Tokens by type', metric('token.usage', month, { bucket: 'day', group_by: ['type'] })],
  [
    'Top tools',
    event(
      'tool_result',
      { fn: 'count' },
      { group_by: ['tool_name'], order: { by: 'value', direction: 'desc' }, limit: 10 },
    ),
  ],
  ['Tool failures', event('tool_result', { fn: 'count' }, { group_by: ['tool_name', 'success'] })],
  ['Edit acceptance', metric('code_edit_tool.decision', month, { group_by: ['decision'] })],
  [
    'Lines changed per day',
    metric('lines_of_code.count', month, { bucket: 'day', group_by: ['type'] }),
  ],
  ['Commits per day', metric('commit.count', month, { bucket: 'day' })],
  ['Today by hour vs typical', metric('cost.usage', last28Days, { bucket: 'hour' })],
  ['When you work', metric('active_time.total', last12Weeks, { bucket: 'hour' })],
  [
    'Active time per day',
    metric('active_time.total', month, { bucket: 'day', group_by: ['type'] }),
  ],
  [
    'API errors',
    event('api_error', { fn: 'count' }, { bucket: 'hour', group_by: ['status_code'] }),
  ],
  [
    'Request latency',
    event(
      'api_request',
      { fn: 'p95', key: 'duration_ms' },
      { bucket: 'hour', group_by: ['model'] },
    ),
  ],
]

let t: TestHub
let alice: TestClient

beforeAll(async () => {
  t = await testHub({ modules: [otel], clock: () => now })
  const ingest = t.as('alice', ['otel:write'], { sourceId: 'laptop' })
  alice = t.as('alice', ['otel:read'])
  // One month: three Sessions a day, morning, afternoon and evening, ending this morning.
  for (let day = 0; day < days; day += 1) {
    for (let n = 0; n < sessionsPerDay; n += 1) {
      const start = new Date(now.getTime() - (days - day) * 86_400_000 + n * 5 * 3_600_000)
      await seedSession(ingest, { sessionId: `s-${String(day)}-${String(n)}`, start })
    }
  }
  const sessionToday = new Date('2026-11-01T07:00:00Z')
  await seedSession(ingest, { sessionId: 'today', start: sessionToday })
  const [stored] = await t.sql<{ events: number; points: number }>(
    `select (select count(*)::int from otel.otel_logs) as events,
      (select count(*)::int from otel.otel_metrics_sum) as points`,
  )
  // 56 Events and 20 points per Session.
  const sessions = days * sessionsPerDay + 1
  if (stored?.events !== 56 * sessions || stored.points !== 20 * sessions) {
    throw new Error(`Seeding stored ${JSON.stringify(stored)}`)
  }
}, 300_000)

afterAll(async () => {
  await t.close()
})

describe('the curated Widget queries', () => {
  it.each(widgets)(`%s runs in under ${String(budgetMs)} ms`, async (name, { path, body }) => {
    const send = () => (body === undefined ? alice.get(path) : alice.post(path, body))
    await (await send()).text() // warm-up: plans and caches
    let best = Number.POSITIVE_INFINITY
    let response: unknown
    // Best of three: `pnpm test` runs every package at once, which stretches wall-clock time.
    for (let round = 0; round < 3; round += 1) {
      const started = performance.now()
      const answered = await send()
      response = await answered.json()
      best = Math.min(best, performance.now() - started)
      expect(answered.status, JSON.stringify(response)).toBe(200)
    }
    const specPath = path.split('?')[0] ?? path
    assertSpecResponse(specPath, body === undefined ? 'get' : 'post', 200, response)
    const found = response as { rows?: unknown[]; items?: unknown[] }
    // Every Widget except commits (the fixtures make none) has data to show.
    expect((found.rows ?? found.items ?? []).length > 0, name).toBe(name !== 'Commits per day')
    expect(best, `${name} took ${best.toFixed(1)} ms`).toBeLessThan(budgetMs)
    expect(t.errors).toEqual([])
  })
})
