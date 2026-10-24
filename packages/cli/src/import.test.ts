import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { claudeCode, fixtureText, pathOf, postOtlp } from '@mitcsutt/embertrail-otel/testing'

import type { Series } from './import/prometheus.ts'
import { hubUrl, startHarness } from './testing/harness.ts'
import type { Harness } from './testing/harness.ts'
import { counter, fakeLoki, fakePrometheus, lokiEntries, sessionLabels } from './testing/stack.ts'

const s = 1000
const minute = 60 * s
// Over a year before the tests run: the Hub takes old timestamps as they are.
const t0 = Date.UTC(2025, 5, 1, 9)
const window = ['--from', '2025-06-01T00:00:00Z', '--to', '2025-06-02T00:00:00Z']

interface Report {
  source: { id: string; name: string } | null
  events: { read: number; sent: number; refused: number; stored?: number } | null
  points: { read: number; sent: number; refused: number; stored?: number } | null
  sessions: number | null
  prometheus: { skipped_metrics: string[] }
  chunks: { read: number; already_imported: number }
  requests: number
}

/** Two Sessions' Claude Code Metrics as Prometheus holds them, 15 s scrapes. */
function promSeries(): { series: Series[]; tokens: number; points: number } {
  const series: Series[] = []
  for (const [i, session] of ['s-a', 's-b'].entries()) {
    const start = t0 + i * 5 * minute
    const labels = sessionLabels(session)
    const tokens = (type: string, increments: number[]) =>
      counter(
        'claude_code_token_usage_tokens_total',
        { ...labels, type, model: 'm' },
        start,
        15 * s,
        increments,
      )
    series.push(
      tokens('input', [1000, 0, 0, 2500, 0, 0, 0, 400]),
      tokens('output', [200, 0, 0, 800, 0, 0, 0, 100]),
      counter(
        'claude_code_cost_usage_USD_total',
        { ...labels, model: 'm' },
        start,
        15 * s,
        [0.01, 0, 0, 0.025, 0, 0, 0, 0.004],
      ),
      counter('claude_code_session_count_total', labels, start, 15 * s, [1, 0, 0, 0]),
    )
  }
  const b = sessionLabels('s-b')
  // The Collector expired this series while the Session was idle, then restarted it at 700.
  series.push({
    labels: { __name__: 'claude_code_lines_of_code_count_total', ...b, type: 'added' },
    samples: [
      { t: t0 + 5 * minute, v: 500 },
      { t: t0 + 5 * minute + 15 * s, v: 500 },
      { t: t0 + 9 * minute, v: 700 },
    ],
  })
  // A counter that dropped: a reset.
  series.push({
    labels: { __name__: 'claude_code_commit_count_total', ...b },
    samples: [
      { t: t0 + 5 * minute, v: 3 },
      { t: t0 + 5 * minute + 15 * s, v: 1 },
    ],
  })
  // A histogram, which the Hub does not store.
  series.push({
    labels: { __name__: 'claude_code_request_duration_bucket', ...b, le: '+Inf' },
    samples: [{ t: t0 + 5 * minute, v: 1 }],
  })
  return { series, tokens: 2 * (3900 + 1100), points: 2 * 10 + 2 + 2 }
}

function lokiData() {
  return [
    ...lokiEntries(claudeCode.logsStartup, 's-a', t0),
    ...lokiEntries(claudeCode.logsTurn, 's-a', t0 + minute),
    ...lokiEntries(claudeCode.logsStartup, 's-b', t0 + 5 * minute),
    ...lokiEntries(claudeCode.logsTurn, 's-b', t0 + 6 * minute),
  ]
}

async function metricSum(h: Harness, metric: string, sourceId: string): Promise<number> {
  const response = await h.t.as('alice', ['otel:read']).post('/api/v1/metrics/query', {
    metric,
    aggregation: 'sum',
    from: '2000-01-01T00:00:00Z',
    to: '2100-01-01T00:00:00Z',
    tz: 'UTC',
    filter: [{ key: 'embertrail.source_id', op: 'eq', value: sourceId }],
  })
  const { rows } = (await response.json()) as { rows: { value: number }[] }
  return rows.reduce((total, row) => total + row.value, 0)
}

describe('import prometheus-loki', () => {
  let h: Harness
  const prom = promSeries()
  const prometheus = fakePrometheus(prom.series)
  const loki = fakeLoki(lokiData())
  const run = async (...extra: string[]) => {
    const result = await h.cli(
      'import',
      'prometheus-loki',
      '--source',
      'history',
      '--prometheus',
      'http://prometheus.test',
      '--loki',
      'http://loki.test',
      ...window,
      '--json',
      ...extra,
    )
    expect(result).toMatchObject({ code: 0, err: '' })
    return JSON.parse(result.out) as Report
  }

  beforeAll(async () => {
    h = await startHarness()
    h.upstreams.set('http://prometheus.test', prometheus.handler)
    h.upstreams.set('http://loki.test', loki.handler)
    await h.cli('login', '--hub', hubUrl, '--token', h.token)
  })
  afterAll(() => h.close())

  it('stores what Prometheus and Loki hold as one Source, and says so', async () => {
    const report = await run()
    expect(report.events).toEqual({ read: 112, sent: 112, refused: 0, stored: 112 })
    expect(report.points).toEqual({
      read: prom.points,
      sent: prom.points,
      refused: 0,
      stored: prom.points,
    })
    expect(report.sessions).toBe(2)
    expect(report.prometheus.skipped_metrics).toEqual(['claude_code_request_duration_bucket'])
    const sourceId = report.source?.id ?? ''
    expect(await metricSum(h, 'claude_code.token.usage', sourceId)).toBe(prom.tokens)
    expect(await metricSum(h, 'claude_code.lines_of_code.count', sourceId)).toBe(1200)
    expect(await metricSum(h, 'claude_code.commit.count', sourceId)).toBe(4)
    expect(await metricSum(h, 'claude_code.cost.usage', sourceId)).toBeCloseTo(0.078, 10)
  })

  it('revokes the ingest Token it used', async () => {
    const tokens = JSON.parse((await h.cli('tokens', 'list', '--json')).out) as {
      kind: string
      name: string
      revoked_at: string | null
    }[]
    const used = tokens.filter((token) => token.kind === 'ingest')
    expect(used.length).toBeGreaterThan(0)
    expect(used.every((token) => token.revoked_at !== null)).toBe(true)
  })

  it('picks up where it stopped, and reading it all again adds nothing', async () => {
    const resumed = await run()
    expect(resumed.chunks).toEqual({ read: 0, already_imported: 8 })
    expect(resumed.events).toMatchObject({ read: 0, stored: 112 })

    const again = await run('--restart', '--chunk', '7m', '--batch-bytes', '4096')
    expect(again.chunks.read).toBeGreaterThan(8)
    expect(again.requests).toBeGreaterThan(2)
    expect(again.events).toEqual({ read: 112, sent: 112, refused: 0, stored: 112 })
    expect(again.points).toMatchObject({ read: prom.points, stored: prom.points })
    expect(await metricSum(h, 'claude_code.token.usage', again.source?.id ?? '')).toBe(prom.tokens)
  })

  it('reads without sending on a dry run', async () => {
    const result = await h.cli(
      'import',
      'prometheus-loki',
      '--source',
      'never',
      '--loki',
      'http://loki.test',
      ...window,
      '--dry-run',
    )
    expect(result.code).toBe(0)
    expect(result.out).toContain('Dry run')
    expect((await h.cli('sources', 'list')).out).not.toContain('never')
  })

  it('refuses a command line it cannot use, before reading anything', async () => {
    const base = ['import', 'prometheus-loki', '--source', 'x']
    expect((await h.cli(...base)).err).toContain('Give --prometheus, --loki or both')
    expect((await h.cli(...base, '--loki', 'http://loki.test', '--gap', 'soon')).code).toBe(2)
    expect((await h.cli(...base, '--loki', 'http://loki.test', '--from', 'yesterday')).code).toBe(2)
    const backwards = await h.cli(
      ...base,
      '--loki',
      'http://loki.test',
      '--from',
      '2025-06-02T00:00:00Z',
      '--to',
      '2025-06-01T00:00:00Z',
    )
    expect(backwards.err).toContain('--from must be before --to')
  })
})

describe('import file', () => {
  let a: Harness
  let b: Harness
  const session = '0d10f12b-8af0-4d75-86a6-b896d3793411'

  beforeAll(async () => {
    ;[a, b] = await Promise.all([startHarness(), startHarness()])
    await a.cli('login', '--hub', hubUrl, '--token', a.token)
    await b.cli('login', '--hub', hubUrl, '--token', b.token)
    const sender = a.t.as('alice', ['otel:write'], { sourceId: 'laptop' })
    const sent = []
    for (const name of Object.values(claudeCode)) {
      sent.push((await postOtlp(sender, pathOf(name), fixtureText(name))).status)
    }
    const labelled = await a.t
      .as('alice', ['otel:write'])
      .put(`/api/v1/sessions/${session}/labels`, { labels: { project: 'demo' } })
    if ([...sent, labelled.status].some((status) => status !== 200)) {
      throw new Error(`Seeding the first Hub failed: ${[...sent, labelled.status].join(', ')}`)
    }
  })
  afterAll(() => Promise.all([a.close(), b.close()]))

  const sessions = async (h: Harness) => {
    const response = await h.t.as('alice', ['otel:read']).get('/api/v1/sessions')
    const { items } = (await response.json()) as {
      items: {
        id: string
        cost_usd: number
        tokens: unknown
        labels: unknown
        started_at: string
      }[]
    }
    return items.map(({ id, cost_usd, tokens, labels, started_at }) => ({
      id,
      cost_usd,
      tokens,
      labels,
      started_at,
    }))
  }

  it('replays an export into another Hub as one Source, and again adds nothing', async () => {
    const path = join(a.home, 'history.jsonl')
    expect((await a.cli('export', 'otel', '--out', path)).code).toBe(0)

    const first = await b.cli('import', 'file', path, '--source', 'moved', '--json')
    expect(first).toMatchObject({ code: 0, err: '' })
    const report = JSON.parse(first.out) as Report & { labels: number }
    expect(report.events).toEqual({ read: 56, sent: 56, refused: 0, stored: 56 })
    expect(report.points).toEqual({ read: 20, sent: 20, refused: 0, stored: 20 })
    expect(report.labels).toBe(1)
    expect(await sessions(b)).toEqual(await sessions(a))

    const small = await b.cli(
      'import',
      'file',
      path,
      '--source',
      'moved',
      '--batch-bytes',
      '4096',
      '--json',
    )
    const again = JSON.parse(small.out) as Report
    expect(again.requests).toBeGreaterThan(report.requests)
    expect(again.events).toMatchObject({ stored: 56 })
    expect(again.points).toMatchObject({ stored: 20 })
    expect(await sessions(b)).toEqual(await sessions(a))
  })

  it('counts lines it cannot read and fails after importing the rest', async () => {
    const path = join(b.home, 'mixed.jsonl')
    await writeFile(path, `not json\n{"other":1}\n${fixtureText(claudeCode.logsTurn)}\n`)
    const result = await b.cli('import', 'file', path, '--source', 'mixed')
    expect(result.code).toBe(1)
    expect(result.out).toContain('Unreadable lines: 2')
    expect(result.err).toContain('2 could not be read')
  })
})
