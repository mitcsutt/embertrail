// @vitest-environment node

// The first Widgets of the Catalogue against the demo dataset on a real Hub: each request is valid
// per the spec, and the data it selects equals the numbers the generator says it made.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { cacheShare } from '#features/widgets/components/CacheShare'
import { costByAccount } from '#features/widgets/components/CostByAccount'
import { costThisWeek } from '#features/widgets/components/CostThisWeek'
import { costToday } from '#features/widgets/components/CostToday'
import { eachDayByModel } from '#features/widgets/components/EachDayByModel'
import { modelMix } from '#features/widgets/components/ModelMix'
import { sessionsPerDay } from '#features/widgets/components/SessionsPerDay'
import { sessionsToday } from '#features/widgets/components/SessionsToday'
import { tokensByType } from '#features/widgets/components/TokensByType'
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

interface Point {
  attributes: Record<string, string>
  value: number
}

interface Body {
  resourceMetrics?: {
    scopeMetrics: {
      metrics: {
        name: string
        sum: {
          dataPoints: {
            asDouble: number
            attributes: { key: string; value: { stringValue?: string } }[]
          }[]
        }
      }[]
    }[]
  }[]
}

/** The generator's own data points of a metric, read back out of the OTLP it sent. */
function dataPoints(metric: string): Point[] {
  return (hub.demo ?? failed('demo')).otlp.flatMap(({ body }) =>
    ((body as Body).resourceMetrics ?? []).flatMap((resource) =>
      resource.scopeMetrics.flatMap((scope) =>
        scope.metrics
          .filter((candidate) => candidate.name === metric)
          .flatMap((candidate) =>
            candidate.sum.dataPoints.map((point) => ({
              value: point.asDouble,
              attributes: Object.fromEntries(
                point.attributes.map(({ key, value }) => [key, value.stringValue ?? '']),
              ),
            })),
          ),
      ),
    ),
  )
}

/** The sum of the points' values by one attribute. */
function sumBy(points: Point[], attribute: string): Record<string, number> {
  const sums: Record<string, number> = {}
  for (const { attributes, value } of points) {
    const key = attributes[attribute] ?? ''
    sums[key] = (sums[key] ?? 0) + value
  }
  return sums
}

function expectSums(actual: Record<string, number>, expected: Record<string, number>) {
  expect(Object.keys(actual).toSorted()).toEqual(Object.keys(expected).toSorted())
  for (const [key, value] of Object.entries(expected)) {
    expect(actual[key], key).toBeCloseTo(value, 6)
  }
}

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

describe('Cost this week', () => {
  it("selects this week's cost, as the generator made it", async () => {
    const data = await loadWidget(hub.client, costThisWeek, testContext(costThisWeek, now()))
    expect(data.cost).toBeCloseTo(facts().costThisWeek, 6)
  })

  it('ignores the Board range: its window is the week', () => {
    const ctx = testContext(costThisWeek, now())
    expect({ from: ctx.from, to: ctx.to }).toEqual(facts().thisWeek)
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

describe('Cost by Account', () => {
  it("selects each Account's cost, and the Inventory names the Accounts", async () => {
    const ctx = testContext(costByAccount, now())
    const data = await loadWidget(hub.client, costByAccount, ctx)
    const inventory = await hub.client.getInventory({ query: { from: ctx.from, to: ctx.to } })

    // The generator's two Accounts are told apart by email (work is .com, personal is .org).
    const byAccount: Record<string, number> = {}
    for (const { accountId, cost } of data.accounts) {
      const email = inventory.accounts.find((account) => account.id === accountId)?.email
      byAccount[email === 'dev@example.com' ? 'work' : 'personal'] = cost
    }
    expectSums(byAccount, facts().costByAccount)
    expect(data.accounts.map(({ cost }) => cost)).toEqual(
      data.accounts.map(({ cost }) => cost).toSorted((a, b) => b - a),
    )
    for (const { accountId } of data.accounts) {
      expect(inventory.accounts.map((account) => account.id)).toContain(accountId)
    }
  })

  it('honours the Account filter it declares', async () => {
    const ctx = testContext(costByAccount, now())
    const { accounts } = await hub.client.getInventory({ query: { from: ctx.from, to: ctx.to } })
    const [first] = accounts
    const data = await loadWidget(
      hub.client,
      costByAccount,
      testContext(costByAccount, now(), { accountId: first?.id }),
    )
    expect(data.accounts.map(({ accountId }) => accountId)).toEqual([first?.id])
  })
})

describe('Sessions today', () => {
  it('selects the Sessions started today, as the generator made it', async () => {
    const data = await loadWidget(hub.client, sessionsToday, testContext(sessionsToday, now()))
    expect(data.sessions).toBe(facts().sessionsToday)
  })

  it('leaves the model filter out, since session.count has no model', async () => {
    const ctx = testContext(sessionsToday, now(), { model: 'claude-opus-4-7' })
    expect(ctx.filter.map(({ key }) => key)).not.toContain('model')
    const data = await loadWidget(hub.client, sessionsToday, ctx)
    expect(data.sessions).toBe(facts().sessionsToday)
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

describe('Sessions per day', () => {
  it("selects the Sessions of each day and start type, adding up to the generator's", async () => {
    const data = await loadWidget(hub.client, sessionsPerDay, testContext(sessionsPerDay, now()))
    const actual: Record<string, number> = {}
    for (const row of data.rows) actual[row.startType] = (actual[row.startType] ?? 0) + row.sessions
    expectSums(actual, sumBy(dataPoints('claude_code.session.count'), 'start_type'))
    expect(data.rows.reduce((total, row) => total + row.sessions, 0)).toBe(facts().sessions)
    expect(new Set(data.rows.map((row) => row.day.slice(-6)))).toEqual(
      new Set(['+02:00', '+01:00']),
    )
  })
})

describe('Model mix', () => {
  it("selects each model's cost, as the generator made it", async () => {
    const data = await loadWidget(hub.client, modelMix, testContext(modelMix, now()))
    expect(data.models).toHaveLength(Object.keys(facts().costByModel).length)
    expectSums(
      Object.fromEntries(data.models.map(({ model, cost }) => [model, cost])),
      facts().costByModel,
    )
  })
})

describe('Cache share', () => {
  it('selects cacheRead over input, cacheRead and cacheCreation', async () => {
    const data = await loadWidget(hub.client, cacheShare, testContext(cacheShare, now()))
    const tokens = sumBy(dataPoints('claude_code.token.usage'), 'type')
    const input = (tokens.input ?? 0) + (tokens.cacheRead ?? 0) + (tokens.cacheCreation ?? 0)
    expect(data.share).toBeCloseTo((tokens.cacheRead ?? 0) / input, 9)
    expect(data.share).toBeGreaterThan(0)
    expect(data.share).toBeLessThan(1)
  })

  it('is empty when the filter leaves no input tokens', async () => {
    const data = await loadWidget(
      hub.client,
      cacheShare,
      testContext(cacheShare, now(), { sourceId: 'nobody' }),
    )
    expect(data.share).toBeNull()
    expect(cacheShare.isEmpty(data)).toBe(true)
  })
})

describe('Tokens by type', () => {
  it("selects each day's tokens by type, adding up to the generator's", async () => {
    const data = await loadWidget(hub.client, tokensByType, testContext(tokensByType, now()))
    const actual: Record<string, number> = {}
    for (const row of data.rows) actual[row.type] = (actual[row.type] ?? 0) + row.tokens
    expectSums(actual, sumBy(dataPoints('claude_code.token.usage'), 'type'))
    expect(Object.keys(actual).toSorted()).toEqual([
      'cacheCreation',
      'cacheRead',
      'input',
      'output',
    ])
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
