// @vitest-environment node

// The Query Widget (#43) against the demo dataset on a real Hub: each Widget of the Catalogue can
// be rebuilt in the editor's terms and asks the Hub for the same rows, and a Board that holds a
// Query Widget comes back from the store unchanged.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createBoard, getBoard } from '#features/boards/data/boards'
import type { BoardDocument } from '#features/boards/types/board'
import { catalogue } from '#features/widgets/constants/catalogue'
import { runRequest } from '#features/widgets/data/runRequest'
import type { QueryWidgetConfig } from '#features/widgets/types/queryWidget'
import { isEmptyQueryData, selectQueryData } from '#features/widgets/utils/queryData'
import { buildQueryRequest, validateQueryConfig } from '#features/widgets/utils/queryWidget'

import { dashboardTestHub } from './hub.ts'
import type { DashboardTestHub } from './hub.ts'
import { assertSpecRequest } from './spec.ts'
import { testContext } from './widget.ts'

let hub: DashboardTestHub
beforeAll(async () => {
  hub = await dashboardTestHub()
})
afterAll(async () => {
  await hub.close()
})

const now = () => (hub.demo ?? failed('demo')).options.now

function failed(what: string): never {
  throw new Error(`${what} is missing`)
}

const metric = (
  name: string,
  rest: Partial<QueryWidgetConfig> & Pick<QueryWidgetConfig, 'chart'>,
): QueryWidgetConfig => ({
  source: { kind: 'metric', name: `claude_code.${name}`, aggregation: 'sum' },
  groupBy: [],
  filter: [],
  ...rest,
})

const event = (
  name: string,
  aggregation: { fn: string; key?: string },
  rest: Partial<QueryWidgetConfig> & Pick<QueryWidgetConfig, 'chart'>,
): QueryWidgetConfig => ({
  source: { kind: 'event', name, aggregation },
  groupBy: [],
  filter: [],
  ...rest,
})

/**
 * Each curated Widget (#16's order) rebuilt as a Query Widget: what an author would pick in the
 * editor to draw the same thing. "Cache share" is a ratio the Widget derives from its rows, so
 * what rebuilds is the rows it derives it from; "Top sessions" lists Sessions, so it rebuilds as
 * cost per `session.id`. "Today by hour vs typical" and "When you work" fold their hourly rows on
 * the client, so the rows compared are the raw hourly ones. A KPI (`period-*`) also asks for the
 * window before the Board's, which a Query Widget cannot, so its rebuild is the daily sum over the
 * Board's window and is compared with the KPI's rows inside that window.
 */
const rebuilds: [id: string, config: QueryWidgetConfig][] = [
  ['period-cost', metric('cost.usage', { bucket: 'day', chart: 'series' })],
  ['cost-today', metric('cost.usage', { chart: 'stat' })],
  ['cost-this-week', metric('cost.usage', { chart: 'stat' })],
  ['each-day-by-model', metric('cost.usage', { bucket: 'day', groupBy: ['model'], chart: 'bars' })],
  ['cost-by-account', metric('cost.usage', { groupBy: ['embertrail.account_id'], chart: 'bars' })],
  ['period-sessions', metric('session.count', { bucket: 'day', chart: 'series' })],
  ['sessions-today', metric('session.count', { chart: 'stat' })],
  ['top-sessions', metric('cost.usage', { groupBy: ['session.id'], limit: 10, chart: 'table' })],
  [
    'sessions-per-day',
    metric('session.count', { bucket: 'day', groupBy: ['start_type'], chart: 'bars' }),
  ],
  ['period-tokens', metric('token.usage', { bucket: 'day', chart: 'series' })],
  ['model-mix', metric('cost.usage', { groupBy: ['model'], chart: 'share' })],
  ['cache-share', metric('token.usage', { groupBy: ['type'], chart: 'table' })],
  ['tokens-by-type', metric('token.usage', { bucket: 'day', groupBy: ['type'], chart: 'series' })],
  [
    'top-tools',
    event('tool_result', { fn: 'count' }, { groupBy: ['tool_name'], limit: 10, chart: 'bar-list' }),
  ],
  [
    'tool-failures',
    event('tool_result', { fn: 'count' }, { groupBy: ['tool_name', 'success'], chart: 'table' }),
  ],
  ['edit-acceptance', metric('code_edit_tool.decision', { groupBy: ['decision'], chart: 'share' })],
  ['period-lines-changed', metric('lines_of_code.count', { bucket: 'day', chart: 'series' })],
  ['period-commits', metric('commit.count', { bucket: 'day', chart: 'series' })],
  [
    'lines-changed-per-day',
    metric('lines_of_code.count', { bucket: 'day', groupBy: ['type'], chart: 'bars' }),
  ],
  ['commits-per-day', metric('commit.count', { bucket: 'day', chart: 'bars' })],
  ['period-active-time', metric('active_time.total', { bucket: 'day', chart: 'series' })],
  ['today-by-hour-vs-typical', metric('cost.usage', { bucket: 'hour', chart: 'series' })],
  ['when-you-work', metric('active_time.total', { bucket: 'hour', chart: 'heatmap' })],
  [
    'active-time-per-day',
    metric('active_time.total', { bucket: 'day', groupBy: ['type'], chart: 'bars' }),
  ],
  [
    'api-errors',
    event('api_error', { fn: 'count' }, { bucket: 'day', groupBy: ['status_code'], chart: 'bars' }),
  ],
  [
    'request-latency',
    event(
      'api_request',
      { fn: 'p95', key: 'duration_ms' },
      { bucket: 'day', groupBy: ['model'], chart: 'series' },
    ),
  ],
]

describe('rebuilding the curated Widgets as Query Widgets', () => {
  it('covers the whole Catalogue', () => {
    expect(rebuilds.map(([id]) => id)).toEqual(catalogue.map((widget) => widget.id))
  })

  it.each(rebuilds.filter(([id]) => id !== 'top-sessions'))(
    '%s asks the Hub for the same rows',
    async (id, config) => {
      const curated = catalogue.find((widget) => widget.id === id) ?? failed(id)
      const ctx = testContext(curated, now())
      expect(validateQueryConfig(config)).toEqual([])

      const request = buildQueryRequest(config, ctx)
      assertSpecRequest(request)
      const rebuilt = (await runRequest(hub.client, request)) as { rows: Row[] }
      const answer = await runRequest(hub.client, curated.request(ctx))
      // A KPI asks twice (the window by bucket, then the window before as one total); the first is the series.
      const original = (id.startsWith('period-') ? (answer as [{ rows: Row[] }])[0] : answer) as {
        rows: Row[]
      }
      const start = Date.parse(ctx.from)
      const inWindow = id.startsWith('period-')
        ? original.rows.filter((row) => Date.parse(row.bucket ?? '') >= start)
        : original.rows

      expect(rebuilt.rows.length).toBeGreaterThan(0)
      expect(rebuilt.rows).toEqual(inWindow)
      // And the rows draw: the shape the chart kind needs is there.
      expect(isEmptyQueryData(selectQueryData(config, rebuilt, ctx))).toBe(false)
    },
  )

  it('top-sessions rebuilds as cost per session, which a Session list agrees with', async () => {
    const config = rebuilds.find(([id]) => id === 'top-sessions')?.[1] ?? failed('top-sessions')
    const curated = catalogue.find((widget) => widget.id === 'top-sessions') ?? failed('catalogue')
    const ctx = testContext(curated, now())
    expect(validateQueryConfig(config)).toEqual([])

    const request = buildQueryRequest(config, ctx)
    assertSpecRequest(request)
    const rebuilt = (await runRequest(hub.client, request)) as { rows: Row[] }
    const listed = (await runRequest(hub.client, curated.request(ctx))) as {
      items: { id: string; cost_usd: number }[]
    }
    const byId = new Map(rebuilt.rows.map((row) => [String(row.group['session.id']), row.value]))

    expect(listed.items.length).toBeGreaterThan(0)
    for (const session of listed.items) {
      expect(byId.get(session.id)).toBeCloseTo(session.cost_usd, 9)
    }
    expect(isEmptyQueryData(selectQueryData(config, rebuilt, ctx))).toBe(false)
  })
})

interface Row {
  bucket?: string
  group: Record<string, unknown>
  value: number | null
}

describe('a Query Widget on a Board', () => {
  it('round-trips through the store unchanged', async () => {
    const query: QueryWidgetConfig = event(
      'api_request',
      { fn: 'p95', key: 'duration_ms' },
      {
        bucket: 'hour',
        groupBy: ['model'],
        filter: [
          { key: 'status_code', op: 'in', value: [200, '201'] },
          { key: 'model', op: 'exists' },
        ],
        chart: 'series',
        limit: 2_000,
      },
    )
    const board: BoardDocument = {
      schema_version: 2,
      name: 'Latency',
      filters: { time: { kind: 'relative', range: 'last-7-days' } },
      items: [
        { i: 'q1', type: 'query', title: 'p95 latency', query },
        {
          i: 'q2',
          type: 'query',
          title: 'Spend',
          query: metric('cost.usage', { chart: 'stat' }),
          override: { model: 'claude-sonnet-4' },
        },
      ],
      layout: [
        { i: 'q1', x: 0, y: 0, w: 6, h: 4 },
        { i: 'q2', x: 6, y: 0, w: 3, h: 2 },
      ],
    }
    const created = await createBoard(hub.client, board)
    const read = await getBoard(hub.client, created.id)
    expect(read.board).toEqual(board)
  })
})
