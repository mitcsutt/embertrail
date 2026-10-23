// @vitest-environment node

// The first Widgets of the Catalogue against the demo dataset on a real Hub: each request is valid
// per the spec, and the data it selects equals the numbers the generator says it made.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { costToday } from '#features/widgets/components/CostToday'
import { eachDayByModel } from '#features/widgets/components/EachDayByModel'
import { topSessions } from '#features/widgets/components/TopSessions'
import { catalogue } from '#features/widgets/constants/catalogue'

import { dashboardTestHub } from './hub.ts'
import type { DashboardTestHub } from './hub.ts'
import { assertSpecRequest } from './spec.ts'
import { loadWidget, testContext } from './widget.ts'

let hub: DashboardTestHub
beforeAll(async () => {
  hub = await dashboardTestHub()
})
afterAll(async () => {
  await hub.close()
})

const facts = () => (hub.demo ?? failed('demo')).facts

const now = () => (hub.demo ?? failed('demo')).options.now

describe('Cost today', () => {
  it("selects today's cost, as the generator made it", async () => {
    const data = await loadWidget(hub.client, costToday, testContext(costToday, now()))
    expect(data.cost).toBeCloseTo(facts().costToday, 6)
  })

  it('honours the Source filter it declares', async () => {
    const data = await loadWidget(
      hub.client,
      costToday,
      testContext(costToday, now(), { sourceId: 'embertrail-demo' }),
    )
    expect(data.cost).toBeCloseTo(facts().costToday, 6)

    const none = await loadWidget(
      hub.client,
      costToday,
      testContext(costToday, now(), { sourceId: 'nobody' }),
    )
    expect(costToday.isEmpty(none)).toBe(true)
  })
})

describe('Each day by model', () => {
  it('selects one row per day and model that add up to the model totals', async () => {
    const data = await loadWidget(hub.client, eachDayByModel, testContext(eachDayByModel, now()))

    const byModel: Record<string, number> = {}
    for (const row of data.rows) byModel[row.model] = (byModel[row.model] ?? 0) + row.cost
    expect(Object.keys(byModel).toSorted()).toEqual(Object.keys(facts().costByModel).toSorted())
    for (const [model, cost] of Object.entries(facts().costByModel)) {
      expect(byModel[model], model).toBeCloseTo(cost, 6)
    }
    // Days are local days in the request's zone, so a day's start carries that zone's offset.
    expect(new Set(data.rows.map((row) => row.day.slice(-6)))).toEqual(
      new Set(['+02:00', '+01:00']),
    )
  })
})

describe('Top sessions', () => {
  it('selects the ten most expensive Sessions, most expensive first', async () => {
    const data = await loadWidget(hub.client, topSessions, testContext(topSessions, now()))

    const expected = facts()
      .sessionFacts.toSorted((a, b) => b.cost - a.cost)
      .slice(0, 10)
    expect(data.sessions.map((session) => session.id)).toEqual(expected.map((s) => s.id))
    data.sessions.forEach((session, index) => {
      expect(session.cost).toBeCloseTo(expected[index]?.cost ?? NaN, 6)
    })
  })
})

describe('the spec check', () => {
  it('accepts every Catalogue request', () => {
    expect(catalogue.length).toBeGreaterThan(0)
    for (const widget of catalogue) {
      assertSpecRequest(widget.request(testContext(widget, now())))
    }
  })

  it('refuses a request the spec does not describe', () => {
    expect(() => {
      assertSpecRequest({
        op: 'queryMetrics',
        body: { metric: 'm', aggregation: 'median' as 'sum', from: 'x', to: 'y', tz: 'UTC' },
      })
    }).toThrow(/does not match the spec/)
    expect(() => {
      assertSpecRequest({ op: 'listSessions', query: { sort: '-nonsense' as '-cost_usd' } })
    }).toThrow(/does not match the spec/)
  })
})

function failed(what: string): never {
  throw new Error(`${what} is missing`)
}
