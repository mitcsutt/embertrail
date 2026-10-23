// @vitest-environment node

// The shared contracts (docs/dashboard.md) run against the real client and a real Hub: a
// QueryContext feeds the requests a Widget returns, `getSelf` answers what Team Boards need, and
// a Board document is stored and replaced the way the Boards data module will.

import { isProblemError } from '@mitcsutt/embertrail-client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { BoardDocument } from '#features/boards/types/board'
import { boardNamespace } from '#features/boards/types/board'
import type { QueryContext } from '#features/filters/types/filters'
import type { WidgetRequest } from '#features/widgets/types/widget'

import { dashboardTestHub } from './hub.ts'
import type { DashboardTestHub } from './hub.ts'

let hub: DashboardTestHub
beforeAll(async () => {
  hub = await dashboardTestHub()
})
afterAll(async () => {
  await hub.close()
})

describe('QueryContext and WidgetRequest', () => {
  const context = (): QueryContext => {
    const { today } = (hub.demo ?? failed('demo')).facts
    return {
      ...today,
      tz: 'Europe/Berlin',
      filter: [{ key: 'embertrail.source_id', op: 'eq', value: 'embertrail-demo' }],
      now: new Date(today.to),
      sessions: {},
    }
  }

  it('runs a request of each op through the client', async () => {
    const ctx = context()
    const requests: WidgetRequest[] = [
      {
        op: 'queryMetrics',
        body: {
          metric: 'claude_code.cost.usage',
          aggregation: 'sum',
          from: ctx.from,
          to: ctx.to,
          tz: ctx.tz,
        },
      },
      {
        op: 'queryEvents',
        body: {
          mode: 'aggregate',
          from: ctx.from,
          to: ctx.to,
          tz: ctx.tz,
          aggregation: { fn: 'count' },
        },
      },
      { op: 'listSessions', query: { ...ctx.sessions, limit: 5 } },
    ]

    // What the Widget framework's runRequest will be: a switch over `op`.
    const run = (request: WidgetRequest): Promise<{ rows?: unknown[]; items?: unknown[] }> => {
      switch (request.op) {
        case 'queryMetrics':
          return hub.client.queryMetrics({ body: request.body })
        case 'queryEvents':
          return hub.client.queryEvents({ body: request.body })
        case 'listSessions':
          return hub.client.listSessions({ query: request.query })
      }
    }
    for (const request of requests) {
      const answer = await run(request)
      expect((answer.rows ?? answer.items ?? []).length, request.op).toBeGreaterThan(0)
    }
  })

  it('accepts the mapped filters, the shape QueryContext.filter promises', async () => {
    const ctx = context()
    const { rows } = await hub.client.queryMetrics({
      body: {
        metric: 'claude_code.cost.usage',
        aggregation: 'sum',
        from: ctx.from,
        to: ctx.to,
        tz: ctx.tz,
        filter: ctx.filter,
      },
    })
    expect(rows[0]?.value).toBeCloseTo((hub.demo ?? failed('demo')).facts.costToday, 6)
  })
})

describe('getSelf', () => {
  it('names the Dashboard User, its Scopes and no Teams', async () => {
    await expect(hub.client.getSelf()).resolves.toMatchObject({
      user: { id: 'dashboard', admin: false },
      scopes: ['otel:read', 'store:read', 'store:write'],
      teams: [],
    })
  })
})

describe('BoardDocument in the store', () => {
  const board: BoardDocument = {
    schema_version: 1,
    name: 'Contract',
    filters: { time: { kind: 'relative', range: 'last-7-days' } },
    items: [
      { i: 's', type: 'section', title: 'Today' },
      { i: 'w1', type: 'widget', widget: 'cost-today', override: { model: 'm' } },
    ],
    layout: [
      { i: 's', x: 0, y: 0, w: 12, h: 1, static: true },
      { i: 'w1', x: 0, y: 1, w: 3, h: 3 },
    ],
  }
  const path = { namespace: boardNamespace, id: 'b-abcde12345' }

  it('is created once, replaced on its ETag, and refuses a stale one', async () => {
    const created = await hub.client.putStoreDocument({
      path,
      header: { 'If-None-Match': '*' },
      body: { data: board },
    })
    const etag = created.headers.ETag ?? ''
    expect(etag).not.toBe('')
    expect((await hub.client.getStoreDocument({ path })).data.data).toEqual(board)

    const renamed = { ...board, name: 'Renamed' }
    await hub.client.putStoreDocument({
      path,
      header: { 'If-Match': etag },
      body: { data: renamed },
    })

    const stale = await hub.client
      .putStoreDocument({ path, header: { 'If-Match': etag }, body: { data: board } })
      .catch((error: unknown) => error)
    expect(isProblemError(stale, 'urn:embertrail:problem:precondition-failed')).toBe(true)
    expect((await hub.client.getStoreDocument({ path })).data.data).toEqual(renamed)
  })
})

function failed(what: string): never {
  throw new Error(`${what} is missing`)
}
