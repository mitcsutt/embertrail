import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'

import { assertModuleContract, testHub } from '@mitcsutt/embertrail-hub/testing'
import type { TestClient, TestHub } from '@mitcsutt/embertrail-hub/testing'
import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { claudeCode, fixture, fixtureText, pathOf, postOtlp } from './testing'
import { maxBodyBytes } from './http'
import { otel } from './module'

const scopes = ['otel:write'] as const
const all = Object.values(claudeCode)

/** A log record the way a non-Claude sender might send it: no session.id, no event.sequence. */
function plainRecord(message: string, timeUnixNano = '1792396800000000000') {
  return {
    timeUnixNano,
    severityNumber: 9,
    severityText: 'INFO',
    body: { stringValue: message },
    attributes: [{ key: 'component', value: { stringValue: 'worker' } }],
  }
}

function plainLogs(records: unknown[], service = 'other-cli') {
  return {
    resourceLogs: [
      {
        resource: { attributes: [{ key: 'service.name', value: { stringValue: service } }] },
        scopeLogs: [{ scope: { name: 'other' }, logRecords: records }],
      },
    ],
  }
}

function metricsOf(metric: Record<string, unknown>) {
  return {
    resourceMetrics: [
      {
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'other-cli' } }] },
        scopeMetrics: [{ scope: { name: 'other' }, metrics: [metric] }],
      },
    ],
  }
}

const point = {
  attributes: [{ key: 'kind', value: { stringValue: 'a' } }],
  startTimeUnixNano: '1792396800000000000',
  timeUnixNano: '1792396860000000000',
  asDouble: 1,
}

describe('the otel Module', () => {
  it('passes the Module contract suite, including the OTLP JSON Lines export', async () => {
    await assertModuleContract(otel, {
      async seed(client) {
        for (const name of all) {
          expect((await postOtlp(client, pathOf(name), fixtureText(name))).status).toBe(200)
        }
      },
    })
  })

  describe('over OTLP/HTTP', () => {
    let t: TestHub
    let sender: TestClient

    const count = async (table: string) => {
      const [row] = await t.sql<{ count: number }>(
        sql.raw(`select count(*)::int as count from otel.${table}`),
      )
      return row?.count
    }

    beforeEach(async () => {
      t = await testHub({ modules: [otel], clock: () => new Date('2026-10-19T09:00:00Z') })
      sender = t.as('alice', scopes, { sourceId: 'laptop' })
    })

    afterEach(async () => {
      assert.deepEqual(t.errors, [], 'the Hub answered with a 500')
      await t.close()
    })

    it('stores each Claude Code fixture exactly once when it is posted twice', async () => {
      for (const name of all) {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const response = await postOtlp(sender, pathOf(name), fixtureText(name))
          expect(response.status).toBe(200)
          expect(await response.json()).toEqual({})
        }
      }
      expect(await count('otel_logs')).toBe(56)
      expect(await count('otel_metrics_sum')).toBe(20)
      expect(await count('otel_metrics_gauge')).toBe(0)
    })

    it('stores every Event with its promoted columns, startup events included', async () => {
      await postOtlp(sender, '/v1/logs', fixtureText(claudeCode.logsStartup))
      const names = await t.sql<{ event_name: string; count: number }>(
        sql`select event_name, count(*)::int as count from otel.otel_logs group by 1 order by 1`,
      )
      expect(names.map((n) => n.event_name)).toEqual([
        'api_request',
        'managed_settings_resolved',
        'mcp_server_connection',
        'plugin_loaded',
        'skill_activated',
        'tool_decision',
        'tool_result',
        'user_prompt',
      ])
      const [request] = await t.sql<Record<string, unknown>>(
        sql`select * from otel.otel_logs where event_name = 'api_request' order by time limit 1`,
      )
      expect(request).toMatchObject({
        owner_id: 'alice',
        source_id: 'laptop',
        service_name: 'claude-code',
        model: 'claude-opus-4-7',
        scope_name: 'com.anthropic.claude_code.events',
        body: 'claude_code.api_request',
        content_hash: null,
      })
      expect(request?.request_id).toMatch(/^req_/)
      expect(request?.prompt_id).toEqual(expect.any(String))
      expect(request?.session_id).toEqual(expect.any(String))
      expect(request?.account_id).toMatch(/^[0-9a-f]{32}$/)
      expect(request?.event_sequence).toEqual(expect.any(Number))
      expect((request?.attributes as Record<string, unknown>).cost_usd).toBe(0.0421537)
    })

    it('stores delta sums with their promoted columns', async () => {
      await postOtlp(sender, '/v1/metrics', fixtureText(claudeCode.metricsFirst))
      const rows = await t.sql<Record<string, unknown>>(
        sql`select metric_name, unit, value, type, model, start_time < time as ordered
          from otel.otel_metrics_sum where metric_name = 'claude_code.token.usage' order by type collate "C"`,
      )
      expect(rows).toEqual([
        {
          metric_name: 'claude_code.token.usage',
          unit: 'tokens',
          value: 2620,
          type: 'cacheCreation',
          model: 'claude-opus-4-7',
          ordered: true,
        },
        {
          metric_name: 'claude_code.token.usage',
          unit: 'tokens',
          value: 64178,
          type: 'cacheRead',
          model: 'claude-opus-4-7',
          ordered: true,
        },
        {
          metric_name: 'claude_code.token.usage',
          unit: 'tokens',
          value: 10,
          type: 'input',
          model: 'claude-opus-4-7',
          ordered: true,
        },
        {
          metric_name: 'claude_code.token.usage',
          unit: 'tokens',
          value: 645,
          type: 'output',
          model: 'claude-opus-4-7',
          ordered: true,
        },
      ])
    })

    it('lands embertrail.* resource attributes in the promoted columns', async () => {
      const body = fixture(claudeCode.logsTurn) as {
        resourceLogs: { resource: { attributes: unknown[] } }[]
      }
      body.resourceLogs[0]?.resource.attributes.push(
        { key: 'embertrail.group.id', value: { stringValue: 'run-42' } },
        { key: 'embertrail.group.kind', value: { stringValue: 'orchestrator' } },
        { key: 'embertrail.parent.session_id', value: { stringValue: 'parent-session' } },
        { key: 'embertrail.role', value: { stringValue: 'worker' } },
      )
      await postOtlp(sender, '/v1/logs', body)
      const rows = await t.sql<Record<string, unknown>>(
        sql`select distinct group_id, group_kind, parent_session_id, role from otel.otel_logs`,
      )
      expect(rows).toEqual([
        {
          group_id: 'run-42',
          group_kind: 'orchestrator',
          parent_session_id: 'parent-session',
          role: 'worker',
        },
      ])

      const metrics = fixture(claudeCode.metricsFirst) as {
        resourceMetrics: { resource: { attributes: unknown[] } }[]
      }
      metrics.resourceMetrics[0]?.resource.attributes.push({
        key: 'embertrail.group.id',
        value: { stringValue: 'run-42' },
      })
      await postOtlp(sender, '/v1/metrics', metrics)
      expect(await t.sql(sql`select distinct group_id from otel.otel_metrics_sum`)).toEqual([
        { group_id: 'run-42' },
      ])
    })

    it('takes Owner and Source from the Token, ignoring any sent in attributes', async () => {
      const body = plainLogs([
        {
          ...plainRecord('forged'),
          attributes: [
            { key: 'owner_id', value: { stringValue: 'mallory' } },
            { key: 'source_id', value: { stringValue: 'elsewhere' } },
            { key: 'embertrail.owner_id', value: { stringValue: 'mallory' } },
            { key: 'embertrail.source_id', value: { stringValue: 'elsewhere' } },
          ],
        },
      ])
      expect((await postOtlp(sender, '/v1/logs?owner_id=mallory', body)).status).toBe(200)
      expect(await t.sql(sql`select owner_id, source_id from otel.otel_logs`)).toEqual([
        { owner_id: 'alice', source_id: 'laptop' },
      ])
    })

    it('needs a Token bound to a Source', async () => {
      const reader = t.as('alice', scopes)
      expect((await postOtlp(reader, '/v1/logs', fixtureText(claudeCode.logsTurn))).status).toBe(
        403,
      )
      expect(await count('otel_logs')).toBe(0)
    })

    it('accepts intValue as a JSON string or number', async () => {
      const record = (sequence: unknown, tokens: unknown) => ({
        timeUnixNano: '1792396800000000000',
        body: { stringValue: 'claude_code.api_request' },
        attributes: [
          { key: 'session.id', value: { stringValue: 'session-1' } },
          { key: 'event.name', value: { stringValue: 'api_request' } },
          { key: 'event.sequence', value: { intValue: sequence } },
          { key: 'input_tokens', value: { intValue: tokens } },
        ],
      })
      await postOtlp(
        sender,
        '/v1/logs',
        plainLogs([record(1, 812), record('2', '812')], 'claude-code'),
      )
      // The same records again, with the other spelling: still stored once each.
      await postOtlp(
        sender,
        '/v1/logs',
        plainLogs([record('1', '812'), record(2, 812)], 'claude-code'),
      )
      expect(
        await t.sql(
          sql`select event_sequence, attributes->'input_tokens' as tokens from otel.otel_logs order by 1`,
        ),
      ).toEqual([
        { event_sequence: 1, tokens: 812 },
        { event_sequence: 2, tokens: 812 },
      ])
    })

    it('stores a gzip body', async () => {
      const response = await postOtlp(
        sender,
        '/v1/logs',
        gzipSync(fixtureText(claudeCode.logsStartup)),
        {
          'content-encoding': 'gzip',
        },
      )
      expect(response.status).toBe(200)
      expect(await count('otel_logs')).toBe(50)
    })

    it('falls back to the observed time for a timestamp after 9999', async () => {
      const record = {
        ...plainRecord('late', '99999999999999999999999'),
        observedTimeUnixNano: '1792396800000000000',
      }
      expect((await postOtlp(sender, '/v1/logs', plainLogs([record]))).status).toBe(200)
      expect(
        await t.sql(
          sql`select time = '2026-10-19T08:00:00Z'::timestamptz as observed from otel.otel_logs`,
        ),
      ).toEqual([{ observed: true }])
    })

    it('replaces U+0000 and lone surrogates rather than failing the batch', async () => {
      const record = {
        ...plainRecord('a\u0000b'),
        attributes: [{ key: 'k\u0000ey', value: { stringValue: 'v\u0000' } }],
      }
      const response = await postOtlp(
        sender,
        '/v1/logs',
        plainLogs([record, plainRecord('cut \ud83d'), plainRecord('clean')], 'nul\u0000-cli'),
      )
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({})
      expect(
        await t.sql(sql`select service_name, body, attributes from otel.otel_logs order by body`),
      ).toEqual([
        { service_name: 'nul\uFFFD-cli', body: 'a\uFFFDb', attributes: { 'k\uFFFDey': 'v\uFFFD' } },
        { service_name: 'nul\uFFFD-cli', body: 'clean', attributes: { component: 'worker' } },
        { service_name: 'nul\uFFFD-cli', body: 'cut \uFFFD', attributes: { component: 'worker' } },
      ])
    })

    it('stores a severityNumber outside 0 to 24 as null, keeping the batch', async () => {
      const huge = { ...plainRecord('huge'), severityNumber: 3000000000 }
      const response = await postOtlp(sender, '/v1/logs', plainLogs([huge, plainRecord('clean')]))
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({})
      expect(
        await t.sql(sql`select body, severity_number from otel.otel_logs order by body`),
      ).toEqual([
        { body: 'clean', severity_number: 9 },
        { body: 'huge', severity_number: null },
      ])
    })

    describe('a non-Claude sender without session.id', () => {
      it('is stored, keyed by service.name', async () => {
        expect((await postOtlp(sender, '/v1/logs', plainLogs([plainRecord('hello')]))).status).toBe(
          200,
        )
        expect(
          await t.sql(
            sql`select service_name, session_id, event_name, body, content_hash is not null as hashed from otel.otel_logs`,
          ),
        ).toEqual([
          {
            service_name: 'other-cli',
            session_id: null,
            event_name: '',
            body: 'hello',
            hashed: true,
          },
        ])
      })

      it('collapses an exact retry', async () => {
        await postOtlp(sender, '/v1/logs', plainLogs([plainRecord('hello')]))
        await postOtlp(sender, '/v1/logs', plainLogs([plainRecord('hello')]))
        expect(await count('otel_logs')).toBe(1)
      })

      it('keeps two distinct records apart', async () => {
        await postOtlp(
          sender,
          '/v1/logs',
          plainLogs([
            plainRecord('hello'),
            plainRecord('goodbye'),
            plainRecord('hello', '1792396800000001000'),
          ]),
        )
        expect(await count('otel_logs')).toBe(3)
      })

      it('defaults service.name to unknown_service', async () => {
        await postOtlp(sender, '/v1/logs', {
          resourceLogs: [{ scopeLogs: [{ logRecords: [plainRecord('anonymous')] }] }],
        })
        expect(await t.sql(sql`select service_name from otel.otel_logs`)).toEqual([
          { service_name: 'unknown_service' },
        ])
      })

      it('stores gauges and de-duplicates their points', async () => {
        const gauge = metricsOf({ name: 'queue.depth', unit: '1', gauge: { dataPoints: [point] } })
        await postOtlp(sender, '/v1/metrics', gauge)
        await postOtlp(sender, '/v1/metrics', gauge)
        expect(await t.sql(sql`select metric_name, value from otel.otel_metrics_gauge`)).toEqual([
          { metric_name: 'queue.depth', value: 1 },
        ])
      })
    })

    describe('partialSuccess', () => {
      const refused = async (body: unknown) => {
        const response = await postOtlp(sender, '/v1/metrics', body)
        expect(response.status).toBe(200)
        return response.json()
      }

      it('refuses cumulative sums and tells the sender to use delta temporality', async () => {
        const body = metricsOf({
          name: 'requests',
          sum: { aggregationTemporality: 2, isMonotonic: true, dataPoints: [point, point] },
        })
        expect(await refused(body)).toEqual({
          partialSuccess: {
            rejectedDataPoints: '2',
            errorMessage:
              'Metric "requests" uses cumulative temporality; Embertrail stores delta sums only. Set OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=delta.',
          },
        })
        expect(await count('otel_metrics_sum')).toBe(0)
      })

      it.each(['histogram', 'exponentialHistogram', 'summary'])('refuses a %s', async (kind) => {
        const body = metricsOf({ name: 'latency', [kind]: { dataPoints: [{}, {}, {}] } })
        expect(await refused(body)).toEqual({
          partialSuccess: {
            rejectedDataPoints: '3',
            errorMessage: `Metric "latency" is a ${kind}; Embertrail stores only sums and gauges.`,
          },
        })
      })

      it('stores the rest of a batch and counts only what it refused', async () => {
        const body = fixture(claudeCode.metricsFirst) as {
          resourceMetrics: { scopeMetrics: { metrics: unknown[] }[] }[]
        }
        body.resourceMetrics[0]?.scopeMetrics[0]?.metrics.push({
          name: 'latency',
          histogram: { dataPoints: [{}] },
        })
        expect(await refused(body)).toEqual({
          partialSuccess: {
            rejectedDataPoints: '1',
            errorMessage:
              'Metric "latency" is a histogram; Embertrail stores only sums and gauges.',
          },
        })
        expect(await count('otel_metrics_sum')).toBe(7)
      })

      it('refuses every span on /v1/traces and stores nothing', async () => {
        const body = {
          resourceSpans: [
            { scopeSpans: [{ spans: [{ name: 'a' }, { name: 'b' }] }, { spans: [{ name: 'c' }] }] },
          ],
        }
        const response = await postOtlp(sender, '/v1/traces', body)
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
          partialSuccess: {
            rejectedSpans: '3',
            errorMessage:
              'Embertrail v1 does not store traces. Disable the traces exporter for this sender.',
          },
        })
      })
    })

    describe('errors', () => {
      const status = async (response: Response, code: number) => {
        expect(response.status).toBe(code)
        expect(response.headers.get('content-type')).toMatch(/^application\/json/)
        const body = (await response.json()) as { code: number; message: string }
        expect(body.code).toBe(3)
        expect(Object.keys(body)).toEqual(['code', 'message'])
        return body.message
      }

      it('answers 415 for anything but JSON', async () => {
        const message = await status(
          await postOtlp(sender, '/v1/logs', new Uint8Array([1, 2, 3]), {
            'content-type': 'application/x-protobuf',
          }),
          415,
        )
        expect(message).toContain('http/json')
        await status(await postOtlp(sender, '/v1/metrics', '{}', { 'content-encoding': 'br' }), 415)
      })

      it('accepts a charset on the media type', async () => {
        const response = await postOtlp(sender, '/v1/logs', '{}', {
          'content-type': 'application/json; charset=utf-8',
        })
        expect(response.status).toBe(200)
      })

      it('answers 413 over 5 MB decoded, plain or gzip', async () => {
        const big = JSON.stringify(plainLogs([plainRecord('x'.repeat(maxBodyBytes))]))
        await status(await postOtlp(sender, '/v1/logs', big), 413)
        // Small on the wire, too large once decoded.
        await status(
          await postOtlp(sender, '/v1/logs', gzipSync(big), { 'content-encoding': 'gzip' }),
          413,
        )
        expect(await count('otel_logs')).toBe(0)
      })

      it('answers 400 for a body that is not JSON, not an object, or not gzip', async () => {
        expect(await status(await postOtlp(sender, '/v1/logs', '{nope'), 400)).toBe(
          'Body is not valid JSON.',
        )
        expect(await status(await postOtlp(sender, '/v1/logs', '[1]'), 400)).toMatch(/JSON object/)
        expect(
          await status(
            await postOtlp(sender, '/v1/logs', '{}', { 'content-encoding': 'gzip' }),
            400,
          ),
        ).toBe('Body is not valid gzip.')
      })
    })

    it('sweeps rows past RETENTION_DAYS and keeps them forever by default', async () => {
      await postOtlp(sender, '/v1/logs', fixtureText(claudeCode.logsTurn))
      expect(await t.hub.runRetention()).toEqual({ deleted: 0 })
      const later = await testHub({
        modules: [otel],
        config: { retentionDays: 3 },
        clock: () => new Date('2026-10-19T09:00:00Z'),
      })
      try {
        const laptop = later.as('alice', scopes, { sourceId: 'laptop' })
        await postOtlp(laptop, '/v1/logs', fixtureText(claudeCode.logsTurn))
        await postOtlp(
          laptop,
          '/v1/logs',
          plainLogs([plainRecord('recent', '1792396800000000000')]),
        )
        // The fixtures are from 2026-10-12, a week before the clock; the plain record is today's.
        expect(await later.hub.runRetention()).toEqual({ deleted: 6 })
        expect(await later.sql(sql`select body from otel.otel_logs`)).toEqual([{ body: 'recent' }])
      } finally {
        await later.close()
      }
    })

    it('keeps one User’s Signals from another', async () => {
      await postOtlp(sender, '/v1/logs', fixtureText(claudeCode.logsTurn))
      const bob = t.as('bob', scopes, { sourceId: 'desktop' })
      await postOtlp(bob, '/v1/logs', fixtureText(claudeCode.logsTurn))
      // Same Session and sequence, different Source: both stored.
      expect(
        await t.sql(
          sql`select owner_id, count(*)::int as count from otel.otel_logs group by 1 order by 1`,
        ),
      ).toEqual([
        { owner_id: 'alice', count: 6 },
        { owner_id: 'bob', count: 6 },
      ])
    })
  })
})
