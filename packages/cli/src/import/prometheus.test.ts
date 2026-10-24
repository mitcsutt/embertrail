import { describe, expect, it } from 'vitest'

import { counter, sessionLabels } from '../testing/stack.ts'

import { convertSeries, counterPoints, otelMetric, seriesAttributes } from './prometheus.ts'

const s = 1000
const minute = 60 * s

describe('otelMetric', () => {
  it.each([
    ['claude_code_session_count_total', 'claude_code.session.count', ''],
    ['claude_code_lines_of_code_count_total', 'claude_code.lines_of_code.count', ''],
    ['claude_code_pull_request_count_total', 'claude_code.pull_request.count', ''],
    ['claude_code_commit_count_total', 'claude_code.commit.count', ''],
    ['claude_code_cost_usage_USD_total', 'claude_code.cost.usage', 'USD'],
    ['claude_code_token_usage_tokens_total', 'claude_code.token.usage', 'tokens'],
    ['claude_code_code_edit_tool_decision_total', 'claude_code.code_edit_tool.decision', ''],
    ['claude_code_active_time_seconds_total', 'claude_code.active_time.total', 's'],
  ])('names %s back as %s', (prom, name, unit) => {
    expect(otelMetric(prom)).toEqual({ name, unit })
  })

  it('keeps a name it does not know', () => {
    expect(otelMetric('my_counter_total')).toEqual({ name: 'my_counter_total', unit: '' })
  })
})

describe('counterPoints', () => {
  const samples = (values: [number, number][]) => values.map(([t, v]) => ({ t, v }))

  it('sends each increase as a delta from the previous scrape, leaving out zeros', () => {
    const points = counterPoints(
      samples([
        [0, 5],
        [15 * s, 5],
        [30 * s, 8],
      ]),
      0,
      minute,
      2 * minute,
    )
    expect(points).toEqual([
      { time: 0, value: 5 },
      { start: 15 * s, time: 30 * s, value: 3 },
    ])
  })

  it('counts a drop as a reset and a silence over the gap as a restart', () => {
    const points = counterPoints(
      samples([
        [0, 10],
        [15 * s, 4],
        [5 * minute, 9],
      ]),
      0,
      10 * minute,
      2 * minute,
    )
    expect(points).toEqual([
      { time: 0, value: 10 },
      { start: 0, time: 15 * s, value: 4 },
      { time: 5 * minute, value: 9 },
    ])
  })

  it('gives the same points whichever windows the samples are read in', () => {
    const all = samples(Array.from({ length: 40 }, (_, i) => [i * 15 * s, i * i]))
    const whole = counterPoints(all, 0, 10 * minute, 2 * minute)
    const parts = [0, 3, 7].flatMap((start, i, starts) =>
      counterPoints(all, start * minute, (starts[i + 1] ?? 10) * minute, 2 * minute),
    )
    expect(parts).toEqual(whole)
  })

  it('rounds away the floating-point noise of a subtraction', () => {
    const points = counterPoints(
      samples([
        [0, 0.1],
        [15 * s, 0.30000000000000004],
      ]),
      15 * s,
      minute,
      minute,
    )
    expect(points).toEqual([{ start: 0, time: 15 * s, value: 0.2 }])
  })
})

describe('seriesAttributes', () => {
  it('restores dotted keys and splits the resource from the point', () => {
    const { own, resource, scope } = seriesAttributes({
      __name__: 'claude_code_token_usage_tokens_total',
      ...sessionLabels('s-1'),
      type: 'input',
      query_source: 'main',
    })
    expect(resource).toEqual({
      'host.arch': 'arm64',
      'os.type': 'darwin',
      'os.version': '24.6.0',
      'service.name': 'claude-code',
      'service.version': '2.1.296',
    })
    expect(own).toMatchObject({ 'session.id': 's-1', 'user.email': 'dev@example.com' })
    expect(own).toMatchObject({ type: 'input', query_source: 'main' })
    expect(own).not.toHaveProperty('job')
    expect(own).not.toHaveProperty('instance')
    expect(scope).toEqual({ name: 'embertrail-import' })
  })
})

describe('convertSeries', () => {
  it('makes delta sums of a counter, with the help as description', () => {
    const series = counter(
      'claude_code_cost_usage_USD_total',
      sessionLabels('s-1'),
      0,
      15 * s,
      [0.5, 0, 0.25],
    )
    const { entries, points, samples } = convertSeries(
      series,
      { type: 'counter', help: 'Cost' },
      0,
      minute,
      2 * minute,
    )
    expect({ points, samples }).toEqual({ points: 2, samples: 3 })
    const [entry] = entries as {
      scopeMetrics: { metrics: Record<string, unknown>[] }[]
    }[]
    expect(entry?.scopeMetrics[0]?.metrics[0]).toMatchObject({
      name: 'claude_code.cost.usage',
      unit: 'USD',
      description: 'Cost',
      sum: {
        aggregationTemporality: 1,
        isMonotonic: true,
        dataPoints: [
          { timeUnixNano: '0', asDouble: 0.5 },
          { startTimeUnixNano: '15000000000', timeUnixNano: '30000000000', asDouble: 0.25 },
        ],
      },
    })
  })
})
