import assert from 'node:assert/strict'

import { testHub } from '@mitcsutt/embertrail-hub/testing'
import type { TestClient, TestHub } from '@mitcsutt/embertrail-hub/testing'
import { sql } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { claudeCode, fixtureText, pathOf, postOtlp } from './testing'
import { otel } from './module'

const tables = ['otel_logs', 'otel_metrics_sum', 'otel_metrics_gauge', 'session_labels']

/**
 * Every stored row but its id, in a stable order, as the database sees it. The Account is
 * compared by its recognition key: each Hub gives its Accounts their own ids.
 */
async function stored(t: TestHub) {
  const out: Record<string, unknown[]> = {}
  for (const table of tables) {
    out[table] = await t.sql(
      sql.raw(
        `select to_jsonb(r) - 'id' - 'updated_at' - 'account_id' || jsonb_build_object('account', a.key) as row
          from otel.${table} r left join core.accounts a on a.id = to_jsonb(r) ->> 'account_id' order by row`,
      ),
    )
  }
  return out
}

/** Posts each line of an OTLP JSON Lines export to the endpoint its payload belongs to. */
async function replay(client: TestClient, jsonLines: string) {
  for (const line of jsonLines.split('\n').filter(Boolean)) {
    const parsed = JSON.parse(line) as {
      sessionLabels?: { session_id: string; labels: Record<string, string> }
    }
    if (parsed.sessionLabels !== undefined) {
      const { session_id: id, labels } = parsed.sessionLabels
      const put = await client.put(`/api/v1/sessions/${encodeURIComponent(id)}/labels`, { labels })
      expect(put.status).toBe(200)
      continue
    }
    const path = 'resourceLogs' in parsed ? '/v1/logs' : '/v1/metrics'
    const response = await postOtlp(client, path, line)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({})
  }
}

const gauge = {
  resourceMetrics: [
    {
      resource: { attributes: [{ key: 'service.name', value: { stringValue: 'other-cli' } }] },
      scopeMetrics: [
        {
          scope: { name: 'other', version: '1' },
          metrics: [
            {
              name: 'queue.depth',
              unit: '1',
              gauge: {
                dataPoints: [{ timeUnixNano: '1792396800123456789', asInt: '7', attributes: [] }],
              },
            },
          ],
        },
      ],
    },
  ],
}

const plain = {
  resourceLogs: [
    {
      resource: { attributes: [{ key: 'service.name', value: { stringValue: 'other-cli' } }] },
      scopeLogs: [
        {
          scope: { name: 'other' },
          logRecords: [
            {
              timeUnixNano: '1792396800000001000',
              severityNumber: 13,
              severityText: 'WARN',
              traceId: '5b8efff798038103d269b633813fc60c',
              spanId: 'eee19b7ec3c1b174',
              body: { kvlistValue: { values: [{ key: 'msg', value: { stringValue: 'hi' } }] } },
              attributes: [
                { key: 'ratio', value: { doubleValue: 0.5 } },
                { key: 'whole', value: { doubleValue: 2 } },
                { key: 'big', value: { intValue: '9007199254740993' } },
                { key: 'list', value: { arrayValue: { values: [{ boolValue: true }, {}] } } },
              ],
            },
          ],
        },
      ],
    },
  ],
}

describe('the OTLP JSON Lines export', () => {
  const hubs: TestHub[] = []

  afterEach(async () => {
    for (const t of hubs.splice(0)) {
      assert.deepEqual(t.errors, [], 'the Hub answered with a 500')
      await t.close()
    }
  })

  const open = async () => {
    const t = await testHub({ modules: [otel] })
    hubs.push(t)
    return { t, sender: t.as('alice', ['otel:write'], { sourceId: 'laptop' }) }
  }

  it('round trips: replaying it into an empty Hub stores the same rows', async () => {
    const first = await open()
    for (const name of Object.values(claudeCode)) {
      await postOtlp(first.sender, pathOf(name), fixtureText(name))
    }
    await postOtlp(first.sender, '/v1/metrics', gauge)
    await postOtlp(first.sender, '/v1/logs', plain)
    await first.sender.put('/api/v1/sessions/later/labels', { labels: { ticket: 'A-1' } })

    const exported = await first.t.hub.exportOwner('otel', 'alice')
    const lines = exported.split('\n').filter(Boolean)
    expect(lines).toHaveLength(56 + 1 + 20 + 1 + 1)

    const second = await open()
    await replay(second.sender, exported)
    expect(await stored(second.t)).toEqual(await stored(first.t))
  })

  it('replayed into the same Hub, stores nothing twice', async () => {
    const { t, sender } = await open()
    for (const name of Object.values(claudeCode)) {
      await postOtlp(sender, pathOf(name), fixtureText(name))
    }
    await postOtlp(sender, '/v1/logs', plain)
    const before = await stored(t)
    await replay(sender, await t.hub.exportOwner('otel', 'alice'))
    expect(await stored(t)).toEqual(before)
  })

  it('exports only the Owner’s rows, never rows a Grant lets them read', async () => {
    const { t, sender } = await open()
    await postOtlp(sender, '/v1/logs', fixtureText(claudeCode.logsTurn))
    await postOtlp(t.as('bob', ['otel:write'], { sourceId: 'desktop' }), '/v1/logs', plain)
    const [account] = await t.sql<{ id: string }>(
      sql`select id from core.accounts where owner_id = 'bob'`,
    )
    await t.hub.directory.grant({ module: 'otel', accountId: account?.id ?? '', userId: 'alice' })
    await t.team('crew', { editors: ['alice'] })

    expect((await t.hub.exportOwner('otel', 'alice')).split('\n').filter(Boolean)).toHaveLength(6)
  })

  it('round trips through GET /api/v1/self/export/otel and ingest', async () => {
    const first = await open()
    for (const name of Object.values(claudeCode)) {
      await postOtlp(first.sender, pathOf(name), fixtureText(name))
    }
    const response = await first.t.as('alice', ['self:manage']).get('/api/v1/self/export/otel')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/jsonl; charset=utf-8')

    const second = await open()
    await replay(second.sender, await response.text())
    expect(await stored(second.t)).toEqual(await stored(first.t))
  })

  it('exports only the Owner’s rows', async () => {
    const { t, sender } = await open()
    await postOtlp(sender, '/v1/logs', fixtureText(claudeCode.logsTurn))
    await postOtlp(t.as('bob', ['otel:write'], { sourceId: 'desktop' }), '/v1/logs', plain)
    expect((await t.hub.exportOwner('otel', 'alice')).split('\n').filter(Boolean)).toHaveLength(6)
    expect((await t.hub.exportOwner('otel', 'bob')).split('\n').filter(Boolean)).toHaveLength(1)
  })
})
