// @vitest-environment node
import { describe, expect, it } from 'vitest'

import type { QueryContext } from '#features/filters/types/filters'
import type { QueryWidgetConfig } from '#features/widgets/types/queryWidget'
import type { WidgetKind } from '#features/widgets/types/widget'
import { assertSpecRequest } from '#test/spec'

import {
  buildQueryRequest,
  chartAvailability,
  InvalidQueryError,
  validateQueryConfig,
} from './queryWidget'

const ctx: QueryContext = {
  from: '2026-10-28T00:00:00+01:00',
  to: '2026-11-05T00:00:00+01:00',
  tz: 'Europe/Berlin',
  filter: [],
  now: new Date('2026-11-04T09:30:00+01:00'),
  sessions: {},
}

const cost: QueryWidgetConfig = {
  source: { kind: 'metric', name: 'claude_code.cost.usage', aggregation: 'sum' },
  groupBy: [],
  filter: [],
  chart: 'stat',
}

const toolCalls: QueryWidgetConfig = {
  source: { kind: 'event', name: 'tool_result', aggregation: { fn: 'count' } },
  groupBy: ['tool_name'],
  filter: [],
  chart: 'bar-list',
  limit: 10,
}

const problems = (config: QueryWidgetConfig) =>
  validateQueryConfig(config).map((issue) => `${issue.field}: ${issue.message}`)

describe('buildQueryRequest', () => {
  it('asks queryMetrics for a Metric, with the Board filters after its own', () => {
    const request = buildQueryRequest(
      {
        ...cost,
        bucket: 'day',
        chart: 'series',
        groupBy: ['model'],
        filter: [{ key: 'type', op: 'eq', value: 'input' }],
      },
      { ...ctx, filter: [{ key: 'embertrail.source_id', op: 'eq', value: 'laptop' }] },
    )
    expect(request).toEqual({
      op: 'queryMetrics',
      body: {
        metric: 'claude_code.cost.usage',
        aggregation: 'sum',
        from: ctx.from,
        to: ctx.to,
        tz: 'Europe/Berlin',
        bucket: 'day',
        group_by: ['model'],
        filter: [
          { key: 'type', op: 'eq', value: 'input' },
          { key: 'embertrail.source_id', op: 'eq', value: 'laptop' },
        ],
      },
    })
  })

  it('leaves out what is not set: no filter, bucket, group_by or limit', () => {
    const request = buildQueryRequest(cost, ctx)
    expect(request.op === 'queryMetrics' && Object.keys(request.body).toSorted()).toEqual([
      'aggregation',
      'from',
      'metric',
      'to',
      'tz',
    ])
  })

  it('asks queryEvents in aggregate mode, naming the Event first, and ranks a top-N by value', () => {
    expect(buildQueryRequest(toolCalls, ctx)).toEqual({
      op: 'queryEvents',
      body: {
        mode: 'aggregate',
        from: ctx.from,
        to: ctx.to,
        tz: 'Europe/Berlin',
        filter: [{ key: 'event.name', op: 'eq', value: 'tool_result' }],
        aggregation: { fn: 'count' },
        group_by: ['tool_name'],
        order: { by: 'value', direction: 'desc' },
        limit: 10,
      },
    })
  })

  it('asks for the newest buckets first when a bucketed query has a limit', () => {
    const request = buildQueryRequest(
      { ...toolCalls, bucket: 'hour', chart: 'series', limit: 500 },
      ctx,
    )
    expect(request.op === 'queryEvents' && request.body).toMatchObject({ limit: 500 })
    expect(request.op === 'queryEvents' && request.body).toMatchObject({
      order: { by: 'bucket', direction: 'desc' },
    })
  })

  it('carries the aggregated attribute for an Event aggregation that needs one', () => {
    const request = buildQueryRequest(
      {
        ...toolCalls,
        source: {
          kind: 'event',
          name: 'api_request',
          aggregation: { fn: 'p95', key: 'duration_ms' },
        },
      },
      ctx,
    )
    expect(request.op === 'queryEvents' && request.body).toMatchObject({
      aggregation: { fn: 'p95', key: 'duration_ms' },
    })
  })

  it('refuses a configuration the Query API would refuse, saying why', () => {
    expect(() => buildQueryRequest({ ...cost, groupBy: ['a', 'b', 'c', 'd'] }, ctx)).toThrow(
      InvalidQueryError,
    )
    expect(() => buildQueryRequest({ ...cost, groupBy: ['a', 'b', 'c', 'd'] }, ctx)).toThrow(
      /at most 3/,
    )
  })
})

describe('validateQueryConfig', () => {
  it('accepts the starting shapes', () => {
    expect(problems(cost)).toEqual([])
    expect(problems(toolCalls)).toEqual([])
  })

  it('holds the Metric and the Event to a name', () => {
    expect(problems({ ...cost, source: { ...cost.source, name: ' ' } })).toEqual([
      'source: Pick a Metric.',
    ])
  })

  it('holds a Metric or Event name to the 200 characters a Board document stores', () => {
    const long = 'x'.repeat(201)
    expect(problems({ ...cost, source: { ...cost.source, name: long } })).toEqual([
      'source: A Metric name is 200 characters at most.',
    ])
    expect(problems({ ...toolCalls, source: { ...toolCalls.source, name: long } })).toEqual([
      'source: An Event name is 200 characters at most.',
    ])
    expect(problems({ ...cost, source: { ...cost.source, name: 'x'.repeat(200) } })).toEqual([])
  })

  it('requires a key for every Event aggregation but count, and forbids one for count', () => {
    const event = (aggregation: { fn: string; key?: string }): QueryWidgetConfig => ({
      ...cost,
      source: { kind: 'event', name: 'api_request', aggregation },
    })
    expect(problems(event({ fn: 'p95' }))).toEqual([
      'aggregation: p95 needs the attribute to aggregate.',
    ])
    expect(problems(event({ fn: 'count', key: 'duration_ms' }))).toEqual([
      'aggregation: Counting Events takes no key.',
    ])
    expect(problems(event({ fn: 'median' }))).toEqual(['aggregation: Pick an aggregation.'])
    expect(problems(event({ fn: 'p95', key: 'duration_ms' }))).toEqual([])
  })

  it('checks Group by keys against the spec’s pattern, their number and that they are distinct', () => {
    expect(problems({ ...cost, chart: 'table', groupBy: ['a', 'b', 'c', 'd'] })).toEqual([
      'groupBy: Group by at most 3 keys.',
    ])
    expect(problems({ ...cost, chart: 'table', groupBy: ['a', 'a'] })).toEqual([
      'groupBy: Each key can be grouped by once.',
    ])
    expect(problems({ ...cost, chart: 'table', groupBy: ['1bad'] })[0]).toMatch(/^groupBy: "1bad"/)
    expect(problems({ ...cost, chart: 'table', groupBy: ['ok.key/x-y_z'] })).toEqual([])
  })

  it('checks each filter: a value for comparisons, members for in, nothing for presence', () => {
    const filtered = (filter: QueryWidgetConfig['filter']) => ({ ...cost, filter })
    expect(problems(filtered([{ key: 'model', op: 'in', value: [] }]))).toEqual([
      'filter: model in needs at least one value.',
    ])
    expect(problems(filtered([{ key: 'model', op: 'in', value: ['a', 1, true] }]))).toEqual([])
    expect(problems(filtered([{ key: 'model', op: 'exists' }]))).toEqual([])
    expect(problems(filtered([{ key: 'model', op: 'gt', value: Number.NaN }]))).toEqual([
      'filter: model gt needs a finite number.',
    ])
    expect(problems(filtered([{ key: 'model', op: 'like' } as never]))).toEqual([
      'filter: model: pick an operator.',
    ])
    expect(
      problems(filtered(Array.from({ length: 17 }, () => ({ key: 'a', op: 'exists' as const })))),
    ).toEqual(['filter: Use at most 16 filters.'])
  })

  it('holds the limit to a whole number from 1 to 10,000', () => {
    for (const limit of [0, 10_001, 1.5]) {
      expect(problems({ ...cost, limit })).toHaveLength(1)
    }
    expect(problems({ ...cost, limit: 10_000 })).toEqual([])
  })

  it('refuses a chart kind the rows cannot draw', () => {
    expect(problems({ ...cost, chart: 'series' })).toEqual(['chart: A line needs a time bucket.'])
  })
})

describe('chartAvailability', () => {
  const available = (shape: Parameters<typeof chartAvailability>[0]) =>
    Object.entries(chartAvailability(shape))
      .filter(([, reason]) => reason === undefined)
      .map(([kind]) => kind)

  it('offers a number for one value, and a table for anything', () => {
    expect(available({ groupBy: [] })).toEqual(['stat', 'table'])
  })

  it('offers lines and bars for a time bucket, with or without groups', () => {
    expect(available({ groupBy: [], bucket: 'day' })).toEqual(['series', 'bars', 'table'])
    expect(available({ groupBy: ['model'], bucket: 'day' })).toEqual(['series', 'bars', 'table'])
  })

  it('offers rankings for groups without a bucket', () => {
    expect(available({ groupBy: ['model'] })).toEqual(['bars', 'bar-list', 'share', 'table'])
  })

  it('offers the heatmap for the hour bucket without groups only', () => {
    expect(available({ groupBy: [], bucket: 'hour' })).toEqual([
      'series',
      'bars',
      'table',
      'heatmap',
    ])
    expect(available({ groupBy: ['model'], bucket: 'hour' })).toEqual(['series', 'bars', 'table'])
  })

  it('says why a kind is unavailable', () => {
    expect(chartAvailability({ groupBy: [], bucket: 'day' }).heatmap).toMatch(/hour bucket/)
    expect(chartAvailability({ groupBy: ['a'] }).stat).toMatch(/one number/)
  })
})

// Property-style (#43 AC1): whatever the editor is driven into, a configuration is either refused
// before a request is built or yields one the spec's own request schema accepts.
const throwsInvalid = (config: QueryWidgetConfig): boolean => {
  try {
    buildQueryRequest(config, ctx)
    return false
  } catch (error) {
    return error instanceof InvalidQueryError
  }
}

describe('every configuration the editor can reach', () => {
  /** mulberry32: a small seeded generator, so a failing case reproduces. */
  function random(seed: number) {
    let a = seed
    return () => {
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
    }
  }

  const goodKeys = ['model', 'tool_name', 'embertrail.account_id', 'a/b-c.d', 'ok_1']
  const badKeys = ['', '9lives', 'has space', 'x'.repeat(129)]
  const chart: WidgetKind[] = ['stat', 'series', 'bars', 'bar-list', 'share', 'table', 'heatmap']
  const goodOps = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'not_in', 'exists', 'not_exists']
  const goodBuckets = [undefined, 'minute', 'hour', 'day', 'week', 'month']
  const goodMetricFns = ['sum', 'avg', 'min', 'max', 'count', 'last']
  const goodEventFns = [
    'count',
    'count_distinct',
    'sum',
    'avg',
    'min',
    'max',
    'p50',
    'p90',
    'p95',
    'p99',
  ]

  it('is refused or accepted by the spec, never in between', () => {
    const next = random(7)
    const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)] as T
    const scalar = () => pick<string | number | boolean>(['a', 'b', 1, 2.5, true, false, ''])
    let accepted = 0
    let refused = 0
    const failures: string[] = []

    for (let run = 0; run < 4_000; run += 1) {
      // Half the runs stay inside the rules except for the chart kind, half wander outside them.
      const wild = next() < 0.5
      const keys = wild ? [...goodKeys, ...badKeys] : goodKeys
      const ops = wild ? [...goodOps, 'regex'] : goodOps
      const filter = Array.from({ length: Math.floor(next() * (wild ? 20 : 5)) }, () => {
        const op = pick(ops)
        const key = pick(keys)
        if (['in', 'not_in'].includes(op)) {
          const size = Math.floor(next() * 4) + (wild ? 0 : 1)
          return { key, op, value: Array.from({ length: size }, scalar) }
        }
        if (['exists', 'not_exists'].includes(op)) return { key, op }
        return { key, op, value: scalar() }
      }) as QueryWidgetConfig['filter']
      const eventFns = wild ? [...goodEventFns, 'p100'] : goodEventFns
      const fn = pick(eventFns)
      const shape = {
        groupBy: Array.from({ length: Math.floor(next() * (wild ? 6 : 4)) }, () =>
          pick(keys),
        ).filter((key, index, all) => wild || all.indexOf(key) === index),
        ...(next() < 0.7 && {
          bucket: pick(wild ? [...goodBuckets, 'year'] : goodBuckets) as 'day',
        }),
      }
      const available = Object.entries(chartAvailability(shape))
        .filter(([, reason]) => reason === undefined)
        .map(([kind]) => kind as WidgetKind)
      const config: QueryWidgetConfig = {
        source:
          next() < 0.5
            ? {
                kind: 'metric',
                name: pick(wild ? ['claude_code.cost.usage', '', ' '] : ['claude_code.cost.usage']),
                aggregation: pick(wild ? [...goodMetricFns, 'median'] : goodMetricFns) as 'sum',
              }
            : {
                kind: 'event',
                name: 'tool_result',
                aggregation: {
                  fn,
                  ...((wild ? next() < 0.6 : fn !== 'count') && { key: pick(keys) }),
                },
              },
        ...shape,
        filter,
        chart: wild ? pick(chart) : pick(available),
        ...(next() < 0.7 && {
          limit: pick(wild ? [0, 1, 10, 1_000, 10_000, 10_001, -3, 2.5] : [1, 10, 1_000, 10_000]),
        }),
      }

      if (validateQueryConfig(config).length > 0) {
        refused += 1
        if (!throwsInvalid(config)) failures.push(`built a request for ${JSON.stringify(config)}`)
      } else {
        accepted += 1
        try {
          assertSpecRequest(buildQueryRequest(config, ctx))
        } catch (error) {
          failures.push(`${JSON.stringify(config)}: ${String(error)}`)
        }
      }
    }
    expect(failures).toEqual([])
    // The property must not hold vacuously.
    expect(accepted).toBeGreaterThan(100)
    expect(refused).toBeGreaterThan(100)
  })
})
