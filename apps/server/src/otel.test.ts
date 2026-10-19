import { assertModuleContract, testHub } from '@mitcsutt/embertrail-hub/testing'
import { otel } from '@mitcsutt/embertrail-otel'
import {
  assertSpecResponse,
  claudeCode,
  fixtureText,
  pathOf,
  postOtlp,
  seedSession,
} from '@mitcsutt/embertrail-otel/testing'
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { openTempDb } from './testing/temp-database'

// The otel Module on Postgres 17 through the Docker Db Adapter: the batched unnest insert,
// its conflict keys and the OTLP JSON Lines export depend on the server's types and indexes,
// which PGLite only approximates. Skipped locally without DATABASE_URL, as db.test.ts is.
const databaseUrl = process.env.DATABASE_URL ?? ''
const fixtures = Object.values(claudeCode)

describe.skipIf(databaseUrl === '' && process.env.CI === undefined)(
  'the otel Module on Postgres',
  () => {
    it('passes the Module contract suite', async () => {
      await assertModuleContract(otel, {
        db: await openTempDb(databaseUrl),
        async seed(client) {
          for (const name of fixtures) {
            expect((await postOtlp(client, pathOf(name), fixtureText(name))).status).toBe(200)
          }
        },
      })
    })

    it('stores each fixture once when it is posted twice, and round trips the export', async () => {
      const first = await testHub({ modules: [otel], db: await openTempDb(databaseUrl) })
      const second = await testHub({ modules: [otel], db: await openTempDb(databaseUrl) })
      try {
        const sender = first.as('alice', ['otel:write'], { sourceId: 'laptop' })
        for (const name of [...fixtures, ...fixtures]) {
          expect((await postOtlp(sender, pathOf(name), fixtureText(name))).status).toBe(200)
        }
        const rows = (t: typeof first) =>
          t.sql(sql`select 'logs' as t, to_jsonb(r) - 'id' as row from otel.otel_logs r
            union all select 'sum', to_jsonb(r) - 'id' from otel.otel_metrics_sum r
            order by 1, 2`)
        expect(await rows(first)).toHaveLength(56 + 20)

        const replayer = second.as('alice', ['otel:write'], { sourceId: 'laptop' })
        for (const line of (await first.hub.exportOwner('otel', 'alice')).split('\n')) {
          if (line === '') continue
          const path = line.startsWith('{"resourceLogs"') ? '/v1/logs' : '/v1/metrics'
          expect(await (await postOtlp(replayer, path, line)).json()).toEqual({})
        }
        expect(await rows(second)).toEqual(await rows(first))
        expect([...first.errors, ...second.errors]).toEqual([])
      } finally {
        await first.close()
        await second.close()
      }
    })

    it('answers every Query API endpoint as the spec says, Labels and zone buckets included', async () => {
      const t = await testHub({ modules: [otel], db: await openTempDb(databaseUrl) })
      try {
        const sender = t.as('alice', ['otel:write'], { sourceId: 'laptop' })
        const alice = t.as('alice', ['otel:read', 'otel:write'])
        const bob = t.as('bob', ['otel:read'])
        await seedSession(sender, { sessionId: 'a', start: new Date('2026-10-24T21:00:00Z') })
        await seedSession(sender, { sessionId: 'b', start: new Date('2026-10-25T23:00:00Z') })
        const labels = { 'embertrail.group.id': 'batch', 'embertrail.parent.session_id': 'a' }
        const put = await alice.put('/api/v1/sessions/b/labels', { labels })
        assertSpecResponse('/api/v1/sessions/{session_id}/labels', 'put', 200, await put.json())

        const window = { from: '2026-10-01T00:00:00Z', to: '2026-11-01T00:00:00Z' }
        const call = async (path: string, method: 'get' | 'post', body?: object, spec = path) => {
          const response = await (method === 'get' ? alice.get(path) : alice.post(path, body))
          const json: unknown = await response.json()
          expect(response.status, JSON.stringify(json)).toBe(200)
          assertSpecResponse(spec.split('?')[0] ?? spec, method, 200, json)
          return json as Record<string, unknown>
        }
        const days = await call('/api/v1/metrics/query', 'post', {
          metric: 'claude_code.session.count',
          aggregation: 'sum',
          ...window,
          tz: 'Europe/Berlin',
          bucket: 'day',
          group_by: ['embertrail.group.id'],
        })
        expect(days.rows).toEqual([
          { bucket: '2026-10-24T00:00:00+02:00', group: { 'embertrail.group.id': null }, value: 1 },
          {
            bucket: '2026-10-26T00:00:00+01:00',
            group: { 'embertrail.group.id': 'batch' },
            value: 1,
          },
        ])
        await call('/api/v1/events/query', 'post', { mode: 'list', ...window, tz: 'UTC', limit: 5 })
        const p95 = await call('/api/v1/events/query', 'post', {
          mode: 'aggregate',
          ...window,
          tz: 'UTC',
          filter: [{ key: 'event.name', op: 'in', value: ['api_request'] }],
          aggregation: { fn: 'p95', key: 'duration_ms' },
          group_by: ['model'],
        })
        expect(p95.rows).toHaveLength(2)
        const sessions = await call('/api/v1/sessions?sort=-cost_usd', 'get')
        expect((sessions.items as { id: string }[]).map((s) => s.id).sort()).toEqual(['a', 'b'])
        const a = await call(
          '/api/v1/sessions/a',
          'get',
          undefined,
          '/api/v1/sessions/{session_id}',
        )
        expect((a.children as { id: string }[]).map((c) => c.id)).toEqual(['b'])
        await call('/api/v1/inventory', 'get')
        const hidden = await bob.post('/api/v1/events/query', {
          mode: 'list',
          ...window,
          tz: 'UTC',
        })
        expect(((await hidden.json()) as { items: unknown[] }).items).toEqual([])
        expect(t.errors).toEqual([])
      } finally {
        await t.close()
      }
    })
  },
)
