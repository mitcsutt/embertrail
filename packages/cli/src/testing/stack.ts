// Fake Prometheus and Loki APIs holding what a Collector (contrib 0.96) writes for Claude Code:
// counters named and labelled as its `prometheus` exporter names them with
// resource_to_telemetry_conversion, and log lines as its `loki` exporter writes them, with the
// event body copied to an `event_name` label and `service.name` as a stream label. The shapes
// were captured from that stack (packages/cli/test/import-stack).

import { fixture } from '@mitcsutt/embertrail-otel/testing'
import type { FixtureName } from '@mitcsutt/embertrail-otel/testing'

import type { Series } from '../import/prometheus.ts'

/** The labels every Claude Code series carries, for one Session. */
export function sessionLabels(sessionId: string): Record<string, string> {
  return {
    exported_job: 'claude-code',
    host_arch: 'arm64',
    instance: 'collector:8889',
    job: 'otel-collector',
    organization_id: 'c70d49da-cfef-4261-a7b4-5735221d55b0',
    os_type: 'darwin',
    os_version: '24.6.0',
    service_name: 'claude-code',
    service_version: '2.1.296',
    session_id: sessionId,
    terminal_type: 'vscode',
    user_account_id: 'user_GptQKcwOzEM9HfA4',
    user_account_uuid: 'ca72921b-07ef-418f-967c-8534a7d0eb40',
    user_email: 'dev@example.com',
    user_id: 'd727930b07618a1b03d941d5909f4a270acebb38a58ea7151be5e3ee3538be73',
  }
}

/**
 * A counter scraped every `interval` ms from `start`: `increments[i]` is what Claude Code added
 * before scrape `i`, and `null` is a missed scrape. The Collector's running total is what
 * Prometheus holds.
 */
export function counter(
  name: string,
  labels: Record<string, string>,
  start: number,
  interval: number,
  increments: readonly (number | null)[],
): Series {
  let total = 0
  const samples: Series['samples'] = []
  increments.forEach((increment, i) => {
    if (increment === null) return
    total += increment
    samples.push({ t: start + i * interval, v: total })
  })
  return { labels: { __name__: name, ...labels }, samples }
}

export const metadata = {
  claude_code_token_usage_tokens_total: [
    { type: 'counter', unit: '', help: 'Number of tokens used' },
  ],
  claude_code_cost_usage_USD_total: [
    { type: 'counter', unit: '', help: 'Cost of the Claude Code session' },
  ],
  claude_code_session_count_total: [
    { type: 'counter', unit: '', help: 'Count of CLI sessions started' },
  ],
  claude_code_request_duration: [{ type: 'histogram', unit: '', help: 'Not imported' }],
}

const json = (body: unknown) => Response.json(body)

/** Prometheus's metadata and instant-query APIs over `series`. */
export function fakePrometheus(series: readonly Series[]) {
  const queries: string[] = []
  const handler = (request: Request): Response => {
    const url = new URL(request.url)
    if (url.pathname === '/api/v1/metadata') return json({ status: 'success', data: metadata })
    if (url.pathname !== '/api/v1/query') return new Response('not found', { status: 404 })
    const query = url.searchParams.get('query') ?? ''
    queries.push(query)
    const match = /^(.*)\[(\d+)ms\]$/.exec(query)
    const time = Number(url.searchParams.get('time')) * 1000
    const range = Number(match?.[2])
    const result = series
      .filter((s) => (s.labels.__name__ ?? '').startsWith('claude_code_'))
      .map((s) => ({
        metric: s.labels,
        // Prometheus 2.x range selectors include both ends.
        values: s.samples
          .filter((sample) => sample.t >= time - range && sample.t <= time)
          .map((sample) => [sample.t / 1000, String(sample.v)]),
      }))
      .filter((s) => s.values.length > 0)
    return json({ status: 'success', data: { resultType: 'matrix', result } })
  }
  return { handler, queries }
}

export interface LokiEntry {
  labels: Record<string, string>
  ts: string
  line: string
}

/** An OTLP `AnyValue` as the plain JSON the exporter writes. */
function unwrap(value: unknown): unknown {
  const v = (value ?? {}) as Record<string, unknown>
  if ('stringValue' in v) return v.stringValue
  if ('boolValue' in v) return v.boolValue
  if ('intValue' in v) return Number(v.intValue)
  if ('doubleValue' in v) return Number(v.doubleValue)
  return null
}

function plain(keyValues: unknown): Record<string, unknown> {
  return Object.fromEntries(
    ((keyValues ?? []) as { key: string; value: unknown }[]).map((kv) => [
      kv.key,
      unwrap(kv.value),
    ]),
  )
}

/**
 * A logs fixture as the Collector's `loki` exporter stores it, moved onto `sessionId` and to
 * start at `start` (ms): one entry per record, the line its JSON encoding.
 */
export function lokiEntries(name: FixtureName, sessionId: string, start: number): LokiEntry[] {
  const request = fixture(name) as {
    resourceLogs: {
      resource: { attributes: unknown }
      scopeLogs: {
        scope: unknown
        logRecords: ({ timeUnixNano: string } & Record<string, unknown>)[]
      }[]
    }[]
  }
  const entries: LokiEntry[] = []
  for (const { resource, scopeLogs } of request.resourceLogs) {
    const resources = plain(resource.attributes)
    const serviceName = String(resources['service.name'])
    delete resources['service.name']
    for (const { scope, logRecords } of scopeLogs) {
      const first = BigInt(logRecords[0]?.timeUnixNano ?? '0')
      for (const record of logRecords) {
        const attributes = plain(record.attributes)
        attributes['session.id'] = sessionId
        const body = unwrap(record.body)
        const ts = String(BigInt(start) * 1_000_000n + BigInt(record.timeUnixNano) - first)
        entries.push({
          labels: {
            event_name: String(body),
            exporter: 'OTLP',
            job: serviceName,
            service_name: serviceName,
          },
          ts,
          line: JSON.stringify({
            body,
            attributes,
            resources,
            instrumentation_scope: scope,
          }),
        })
      }
    }
  }
  return entries
}

/** Loki's `query_range`, forward, over `entries`, holding to `limit` lines a page. */
export function fakeLoki(entries: readonly LokiEntry[]) {
  const pages: string[] = []
  const handler = (request: Request): Response => {
    const url = new URL(request.url)
    if (url.pathname !== '/loki/api/v1/query_range')
      return new Response('not found', { status: 404 })
    const start = BigInt(url.searchParams.get('start') ?? '0')
    const end = BigInt(url.searchParams.get('end') ?? '0')
    const limit = Number(url.searchParams.get('limit'))
    pages.push(`${String(start)}-${String(end)}`)
    const found = entries
      .filter((e) => BigInt(e.ts) >= start && BigInt(e.ts) < end)
      .sort((a, b) => (BigInt(a.ts) < BigInt(b.ts) ? -1 : BigInt(a.ts) > BigInt(b.ts) ? 1 : 0))
      .slice(0, limit)
    const streams = new Map<
      string,
      { stream: Record<string, string>; values: [string, string][] }
    >()
    for (const e of found) {
      const key = JSON.stringify(e.labels)
      const stream = streams.get(key) ?? { stream: e.labels, values: [] }
      stream.values.push([e.ts, e.line])
      streams.set(key, stream)
    }
    return json({
      status: 'success',
      data: { resultType: 'streams', result: [...streams.values()] },
    })
  }
  return { handler, pages }
}
