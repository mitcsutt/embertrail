// @vitest-environment node

// The filters feature against a real Hub: the Inventory fills the pickers, and the Query API
// filters `toQueryContext` maps from the Board's filters select the data they name.

import { QueryClient } from '@tanstack/react-query'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { inventoryQueryOptions } from '#features/filters/data/inventory'
import type { BoardFilters } from '#features/filters/types/filters'
import { filterOptions } from '#features/filters/utils/filterOptions'
import { resolveWindow } from '#features/filters/utils/resolveWindow'
import { toQueryContext } from '#features/filters/utils/toQueryContext'

import { dashboardTestHub } from './hub.ts'
import type { DashboardTestHub } from './hub.ts'

const tz = 'Europe/Berlin'

let hub: DashboardTestHub
beforeAll(async () => {
  hub = await dashboardTestHub()
})
afterAll(async () => {
  await hub.close()
})

function demo() {
  if (hub.demo === undefined) throw new Error('The test Hub holds no demo data')
  return hub.demo
}

describe('data/inventory', () => {
  it('fills the pickers: the demo Source, its Accounts by label, and its models', async () => {
    const window = resolveWindow(
      { kind: 'relative', range: 'last-30-days' },
      demo().options.now,
      tz,
    )

    const inventory = await new QueryClient().query(inventoryQueryOptions(hub.client, window))
    const options = filterOptions(inventory, {})

    expect(options.sources.map(({ value }) => value)).toEqual(['embertrail-demo'])
    expect(options.accounts.map(({ description }) => description).sort()).toEqual([
      'dev@example.com',
      'dev@example.org',
    ])
    expect(options.models.length).toBe(Object.keys(demo().facts.costByModel).length)
    expect(options.models.map(({ value }) => value).sort()).toEqual(
      Object.keys(demo().facts.costByModel).sort(),
    )
  })

  it('reads the window it is given', async () => {
    // A week before the data begins: nothing is seen.
    const before = resolveWindow(
      { kind: 'absolute', from: '2025-01-01', to: '2025-01-07' },
      demo().options.now,
      tz,
    )

    const inventory = await new QueryClient().query(inventoryQueryOptions(hub.client, before))

    expect(inventory.models).toEqual([])
    expect(inventory.accounts).toEqual([])
  })

  it('keys on the window, so a changed range is a new request', () => {
    const now = demo().options.now
    const key = (range: 'today' | 'yesterday') =>
      inventoryQueryOptions(hub.client, resolveWindow({ kind: 'relative', range }, now, tz))
        .queryKey

    expect(key('today')).not.toEqual(key('yesterday'))
    expect(key('today')).toEqual(key('today'))
  })
})

describe('toQueryContext against the Hub', () => {
  const widget = { window: 'board', filters: ['source', 'account', 'model'] } as const
  const board: BoardFilters = { time: { kind: 'relative', range: 'today' } }

  async function costOf(filters: BoardFilters, override?: BoardFilters) {
    const ctx = toQueryContext(filters, override, widget, demo().options.now, tz)
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
    return rows[0]?.value ?? 0
  }

  it('resolves "today" to the window the demo facts name', () => {
    const ctx = toQueryContext(board, undefined, widget, demo().options.now, tz)

    expect({ from: ctx.from, to: ctx.to }).toEqual(demo().facts.today)
  })

  it('resolves "this week" to the window the demo facts name', () => {
    const ctx = toQueryContext(
      { time: { kind: 'relative', range: 'this-week' } },
      undefined,
      widget,
      demo().options.now,
      tz,
    )

    expect({ from: ctx.from, to: ctx.to }).toEqual(demo().facts.thisWeek)
  })

  it('sums the cost the facts name with no filter, and with the Source filter', async () => {
    expect(await costOf(board)).toBeCloseTo(demo().facts.costToday, 6)
    expect(await costOf({ ...board, sourceId: 'embertrail-demo' })).toBeCloseTo(
      demo().facts.costToday,
      6,
    )
    expect(await costOf({ ...board, sourceId: 'no-such-source' })).toBe(0)
  })

  it('narrows to one model', async () => {
    const [model] = Object.keys(demo().facts.costByModel)
    if (model === undefined) throw new Error('The demo data has no model')

    const all = await costOf(board)
    const one = await costOf({ ...board, model })

    expect(one).toBeGreaterThan(0)
    expect(one).toBeLessThanOrEqual(all)
  })

  it('narrows to one Account, by the id the Inventory gives', async () => {
    // All the demo data: both Accounts have Sessions in it, which one day need not.
    const everything: BoardFilters = { time: { kind: 'relative', range: 'last-90-days' } }
    const window = resolveWindow(everything.time, demo().options.now, tz)
    const inventory = await hub.client.getInventory({ query: window })
    const [first, second] = inventory.accounts
    if (first === undefined || second === undefined) throw new Error('Expected two Accounts')

    const byNumber = (a: number, b: number) => a - b
    const costs = [
      await costOf({ ...everything, accountId: first.id }),
      await costOf({ ...everything, accountId: second.id }),
    ].sort(byNumber)
    const known = Object.values(demo().facts.costByAccount).sort(byNumber)

    expect(costs).toHaveLength(known.length)
    costs.forEach((cost, i) => {
      expect(cost).toBeCloseTo(known[i] ?? Number.NaN, 6)
    })
  })

  it('lets a pinned override win over the Board filter', async () => {
    const [model] = Object.keys(demo().facts.costByModel)
    if (model === undefined) throw new Error('The demo data has no model')

    const pinned = await costOf({ ...board, model: 'no-such-model' }, { ...board, model })

    expect(pinned).toBe(await costOf({ ...board, model }))
  })
})
