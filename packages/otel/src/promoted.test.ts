// `promoted.ts` is the one table of the promoted attributes: these tests hold the Drizzle
// schema and the migrated database to it, and push every row through ingest, the Query API and
// the export, so a promotion that one reader misses fails here.

import assert from 'node:assert/strict'

import { testHub } from '@mitcsutt/embertrail-hub/testing'
import type { TestClient, TestHub } from '@mitcsutt/embertrail-hub/testing'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { otel } from './module'
import { promotions, unpromoted } from './promoted'
import type { Promotion, Signal } from './promoted'
import { logs, metricsGauge, metricsSum } from './schema'
import { postOtlp } from './testing'

const tables = [
  { name: 'otel_logs', table: logs, signal: 'event' },
  { name: 'otel_metrics_sum', table: metricsSum, signal: 'metric' },
  { name: 'otel_metrics_gauge', table: metricsGauge, signal: 'metric' },
] as const

/** The columns a table has: every promotion's, and those that hold no promoted attribute. */
function expectedColumns(name: string, signal: Signal) {
  const columns = [
    ...promotions[signal].map((p) => p.column),
    ...unpromoted.shared,
    ...unpromoted[signal],
  ]
  return columns.filter((c) => name !== 'otel_metrics_gauge' || c !== 'is_monotonic').sort()
}

describe('the table of promoted attributes', () => {
  let t: TestHub

  beforeAll(async () => {
    t = await testHub({ modules: [otel] })
  })

  afterAll(async () => {
    await t.close()
  })

  it.each(tables)(
    'has a row for each column of $name, in the schema and the database',
    async (x) => {
      const expected = expectedColumns(x.name, x.signal)
      expect(
        getTableConfig(x.table)
          .columns.map((c) => c.name)
          .sort(),
      ).toEqual(expected)
      const migrated = await t.sql<{ column_name: string; data_type: string }>(
        `select column_name, data_type from information_schema.columns
      where table_schema = 'otel' and table_name = '${x.name}'`,
      )
      expect(migrated.map((c) => c.column_name).sort()).toEqual(expected)
      for (const p of promotions[x.signal]) {
        expect(migrated.find((c) => c.column_name === p.column)?.data_type, p.column).toBe(p.type)
      }
    },
  )

  it('lists each key and column once per Signal', () => {
    for (const signal of ['metric', 'event'] as const) {
      const rows = promotions[signal]
      expect(new Set(rows.map((p) => p.key)).size).toBe(rows.length)
      expect(new Set(rows.map((p) => p.column)).size).toBe(rows.length)
    }
  })
})

type Value = string | number

const nanos = (iso: string) => String(BigInt(Date.parse(iso)) * 1_000_000n)
const at = '2026-10-12T09:00:00Z'
const window = { from: '2026-10-01T00:00:00Z', to: '2026-12-01T00:00:00Z', tz: 'UTC' }

const keyValues = (attributes: Record<string, Value>) =>
  Object.entries(attributes).map(([key, value]) => ({
    key,
    value: typeof value === 'number' ? { intValue: value } : { stringValue: value },
  }))

/** A resource and a record or point with these attributes, where the table says to look. */
function envelope(resource: Record<string, Value>, own: Record<string, Value>) {
  return {
    resource: { attributes: keyValues({ 'service.name': 'test', ...resource }) },
    own: keyValues(own),
  }
}

function event(resource: Record<string, Value>, own: Record<string, Value>) {
  const e = envelope(resource, own)
  return {
    resourceLogs: [
      {
        resource: e.resource,
        scopeLogs: [
          { scope: { name: 'test' }, logRecords: [{ timeUnixNano: nanos(at), attributes: e.own }] },
        ],
      },
    ],
  }
}

function sum(name: string, resource: Record<string, Value>, own: Record<string, Value>) {
  const e = envelope(resource, own)
  const point = { attributes: e.own, startTimeUnixNano: nanos(at), timeUnixNano: nanos(at) }
  return {
    resourceMetrics: [
      {
        resource: e.resource,
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
                  dataPoints: [{ ...point, asDouble: 1 }],
                },
              },
            ],
          },
        ],
      },
    ],
  }
}

/** A promotion's case: the attribute is on the record, or on the resource where it may be. */
interface Case {
  signal: Signal
  promotion: Promotion
  placement: 'own' | 'resource'
  /** What is sent. */
  value: Value
  /** What a query reads back: a reserved Label overrides the link keys. */
  read: Value
  /** The Session of a link key, which gets a Label. */
  session: string | undefined
}

const cases = (['metric', 'event'] as const).flatMap((signal) =>
  (promotions[signal] as readonly Promotion[]).flatMap((promotion): Case[] => {
    if (promotion.from !== 'attributes' && promotion.from !== 'own') return []
    const placements =
      promotion.from === 'attributes' ? (['own', 'resource'] as const) : (['own'] as const)
    return placements.map((placement) => {
      const value = promotion.type === 'bigint' ? 7 : `v:${signal}:${promotion.key}:${placement}`
      return {
        signal,
        promotion,
        placement,
        value,
        read: promotion.labelled === true ? `label:${signal}:${promotion.key}:${placement}` : value,
        session:
          promotion.labelled === true ? `s:${signal}:${promotion.key}:${placement}` : undefined,
      }
    })
  }),
)

const metricOf = (c: Case) => `m:${c.promotion.key}:${c.placement}`

function sent(c: Case) {
  const attributes: Record<string, Value> = { [c.promotion.key]: c.value }
  if (c.session !== undefined) attributes['session.id'] = c.session
  const [resource, own] = c.placement === 'resource' ? [attributes, {}] : [{}, attributes]
  return c.signal === 'event' ? event(resource, own) : sum(metricOf(c), resource, own)
}

async function query(client: TestClient, c: Case, value: Value, group: boolean) {
  const key = c.promotion.key
  const filter = [{ key, op: 'eq', value }]
  const response =
    c.signal === 'event'
      ? await client.post('/api/v1/events/query', {
          ...window,
          mode: 'aggregate',
          aggregation: { fn: 'count' },
          filter,
          ...(group ? { group_by: [key] } : {}),
        })
      : await client.post('/api/v1/metrics/query', {
          ...window,
          metric: metricOf(c),
          aggregation: 'sum',
          filter,
          ...(group ? { group_by: [key] } : {}),
        })
  expect(response.status).toBe(200)
  return ((await response.json()) as { rows: unknown[] }).rows
}

describe('every promoted attribute, through ingest, the Query API and the export', () => {
  let a: TestHub
  let b: TestHub

  beforeAll(async () => {
    a = await testHub({ modules: [otel] })
    b = await testHub({ modules: [otel] })
    const sender = a.as('alice', ['otel:write'], { sourceId: 'laptop' })
    for (const c of cases) {
      const path = c.signal === 'event' ? '/v1/logs' : '/v1/metrics'
      assert.equal((await postOtlp(sender, path, sent(c))).status, 200)
      if (c.session === undefined) continue
      // A Session summary shows a group's kind only with its id.
      const labels = { 'embertrail.group.id': 'g', [c.promotion.key]: String(c.read) }
      assert.equal(
        (await sender.put(`/api/v1/sessions/${c.session}/labels`, { labels })).status,
        200,
      )
    }
    const exported = await new Response(a.hub.exportOwner('otel', 'alice')).text()
    const replayer = b.as('alice', ['otel:write'], { sourceId: 'laptop' })
    for (const line of exported.split('\n').filter(Boolean)) {
      const parsed = JSON.parse(line) as {
        sessionLabels?: { session_id: string; labels: Record<string, string> }
      }
      const response =
        parsed.sessionLabels === undefined
          ? await postOtlp(
              replayer,
              line.startsWith('{"resourceLogs"') ? '/v1/logs' : '/v1/metrics',
              line,
            )
          : await replayer.put(`/api/v1/sessions/${parsed.sessionLabels.session_id}/labels`, {
              labels: parsed.sessionLabels.labels,
            })
      assert.equal(response.status, 200)
    }
  })

  afterAll(async () => {
    await a.close()
    await b.close()
  })

  it.each(cases.map((c) => [`${c.signal} ${c.promotion.key} (${c.placement})`, c] as const))(
    '%s',
    async (_, c) => {
      for (const hub of [a, b]) {
        const client = hub.as('alice', ['otel:read'])
        expect(await query(client, c, c.read, false)).toEqual([{ group: {}, value: 1 }])
        expect(await query(client, c, c.read, true)).toEqual([
          { group: { [c.promotion.key]: c.read }, value: 1 },
        ])
        if (c.session === undefined) continue
        // The Label replaces the column, so what the Signal sent no longer matches.
        expect(await query(client, c, c.value, false)).toEqual([])
        const session = (await (
          await client.get(`/api/v1/sessions/${c.session}`)
        ).json()) as Record<string, unknown>
        // The summary nests the group's two columns.
        const summary = { group_id: ['group', 'id'], group_kind: ['group', 'kind'] }[
          c.promotion.column
        ] ?? [c.promotion.column]
        expect(summary.reduce<unknown>((v, k) => (v as Record<string, unknown>)[k], session)).toBe(
          c.read,
        )
      }
    },
  )
})
