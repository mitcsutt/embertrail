// @vitest-environment node

// The demo dataset is deterministic, its facts are the numbers the Hub reads back, and the 20
// curated Widget requests (#16) all find data in it, including a Session Group three levels deep
// and a Label that moves a Session between groups.

import type { OperationInput } from '@mitcsutt/embertrail-client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { WidgetRequest } from '#features/widgets/types/widget'

import { dashboardTestHub } from '../hub.ts'
import type { DashboardTestHub } from '../hub.ts'
import { addDays, dayBounds, demoDataset, demoNow, localDate, zonedTime } from './index.ts'
import type { CalendarDate } from './index.ts'

/** The value, or a failure that says what was missing, so a test needs no `!`. */
function defined<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`${what} is missing`)
  return value
}

describe('the generator', () => {
  it('makes the same dataset for the same options and another for another seed', () => {
    const first = demoDataset({ days: 6 })
    expect(demoDataset({ days: 6 })).toEqual(first)
    expect(demoDataset({ days: 6, seed: 2 }).otlp).not.toEqual(first.otlp)
  })

  it('never makes a Signal after now', () => {
    const { otlp } = demoDataset({ days: 6 })
    const times = JSON.stringify(otlp).match(/"timeUnixNano":"(\d+)"/g) ?? []
    expect(times.length).toBeGreaterThan(0)
    const latest = Math.max(
      ...times.map((found) => Number(BigInt(found.replaceAll(/\D/g, '')) / 1_000_000n)),
    )
    expect(latest).toBeLessThan(demoNow.getTime())
  })

  it.each([
    ['Europe/Berlin', '2026-10-25T01:00:00Z'],
    ['America/New_York', '2026-11-01T06:00:00Z'],
  ])('runs a Session across the %s clock change', (tz, change) => {
    const hours = (day: CalendarDate) => {
      const bounds = dayBounds(tz, day)
      return (bounds.to.getTime() - bounds.from.getTime()) / 3_600_000
    }
    const day = localDate(tz, new Date(change))
    expect(hours(day)).toBe(25)
    const crossing = demoDataset({ tz }).facts.sessionFacts.filter(
      (session) =>
        Date.parse(session.start) < Date.parse(change) &&
        Date.parse(session.end) > Date.parse(change),
    )
    expect(crossing).toHaveLength(1)
  })

  it('sends a non-Claude sender that the Claude Code Widgets cannot see', () => {
    const { otlp, facts } = demoDataset({ sender: 'other' })
    expect(otlp.map((request) => request.path)).toEqual(['/v1/logs', '/v1/metrics'])
    expect(JSON.stringify(otlp).includes('claude_code')).toBe(false)
    expect(facts.sessions).toBe(0)
  })
})

// The Hub below ingests this same dataset, since the generator is deterministic.
const { facts, options } = demoDataset()
const tz = options.tz
const all = {
  from: zonedTime(tz, addDays(localDate(tz, demoNow), -40)).toISOString(),
  to: facts.today.to,
}

// The queries read a month of data on PGLite; the headroom is for a busy machine, as in the other packages.
describe('the demo dataset on a test Hub', { timeout: 30_000 }, () => {
  let hub: DashboardTestHub

  beforeAll(async () => {
    hub = await dashboardTestHub({ labels: false })
  }, 300_000)

  afterAll(async () => {
    await hub.close()
  })

  const sum = (rows: { value: number | null }[]) =>
    rows.reduce((total, row) => total + (row.value ?? 0), 0)

  const cost = (window: { from: string; to: string }, rest = {}) =>
    hub.client.queryMetrics({
      body: { metric: 'claude_code.cost.usage', aggregation: 'sum', ...window, tz, ...rest },
    })

  it('ingests the dataset it was asked for', () => {
    expect(hub.demo?.facts).toEqual(facts)
  })

  it('stores every Event and data point it made', async () => {
    const [stored] = await hub.t.sql<{ events: number; points: number }>(
      `select (select count(*)::int from otel.otel_logs) as events,
        (select count(*)::int from otel.otel_metrics_sum) as points`,
    )
    expect(stored).toEqual({ events: facts.eventCount, points: facts.pointCount })
    expect(hub.t.errors).toEqual([])
  })

  it('reads back the totals the facts promise', async () => {
    expect(sum((await cost(facts.today)).rows)).toBeCloseTo(facts.costToday, 6)
    expect(sum((await cost(facts.thisWeek)).rows)).toBeCloseTo(facts.costThisWeek, 6)
    expect(facts.costToday).toBeGreaterThan(0)
    const everything = await cost(all)
    expect(sum(everything.rows)).toBeCloseTo(facts.cost, 6)
    const byModel = await cost(all, { group_by: ['model'] })
    for (const row of byModel.rows) {
      expect(row.value).toBeCloseTo(facts.costByModel[String(row.group.model)] ?? NaN, 6)
    }
    expect(byModel.rows).toHaveLength(Object.keys(facts.costByModel).length)
    const sessionsToday = await hub.client.queryMetrics({
      body: { metric: 'claude_code.session.count', aggregation: 'sum', ...facts.today, tz },
    })
    expect(sum(sessionsToday.rows)).toBe(facts.sessionsToday)
    expect(facts.sessionsToday).toBeGreaterThanOrEqual(2)
  })

  it('has two Accounts that split the cost as the facts say', async () => {
    const byAccount = await cost(all, { group_by: ['embertrail.account_id'] })
    expect(byAccount.rows).toHaveLength(2)
    const inventory = await hub.client.getInventory()
    expect(inventory.accounts.map((account) => account.email).sort()).toEqual([
      'dev@example.com',
      'dev@example.org',
    ])
    const split = byAccount.rows.map((row) => row.value ?? 0).sort((a, b) => a - b)
    expect(split[0]).toBeCloseTo(facts.costByAccount.personal, 6)
    expect(split[1]).toBeCloseTo(facts.costByAccount.work, 6)
    expect(inventory.models.length).toBeGreaterThanOrEqual(2)
    expect(inventory.sources.map((source) => source.name)).toEqual(['embertrail-demo'])
  })

  it('has a Session Group three levels deep, and a Label that moves one Session', async () => {
    const relabelled = defined(facts.relabelled, 'the relabelled Session')
    const members = async (groupId: string) =>
      (await hub.client.listSessions({ query: { group_id: groupId, limit: 100 } })).items

    const before = await members(relabelled.from)
    expect(before.map((session) => session.id)).toContain(relabelled.sessionId)

    await hub.applyLabels()
    const after = await members(relabelled.from)
    expect(after.map((session) => session.id)).not.toContain(relabelled.sessionId)
    const moved = await hub.client.getSession({ path: { session_id: relabelled.sessionId } })
    expect(moved.group?.id).toBe(relabelled.to)

    const deep = defined(
      facts.groups.find((group) => group.depth === 3),
      'a group three levels deep',
    )
    const sessions = await members(deep.id)
    const parent = new Map(sessions.map((session) => [session.id, session.parent_session_id]))
    const level = (id: string): number => {
      const up = parent.get(id)
      return up === undefined || up === null || !parent.has(up) ? 1 : 1 + level(up)
    }
    expect(sessions.map((session) => session.id).sort()).toEqual([...deep.sessionIds].sort())
    expect(Math.max(...sessions.map((session) => level(session.id)))).toBe(3)
  })

  it('totals each group to the sum of its members', async () => {
    const byGroup = await cost(all, { group_by: ['embertrail.group.id'] })
    for (const group of facts.groups) {
      const row = byGroup.rows.find((found) => found.group['embertrail.group.id'] === group.id)
      expect(row?.value, group.id).toBeCloseTo(group.cost, 6)
    }
    const first = defined(facts.groups[0], 'a group')
    const fromSessions = await hub.client.listSessions({
      query: { group_id: first.id, limit: 100 },
    })
    expect(sum(fromSessions.items.map((session) => ({ value: session.cost_usd })))).toBeCloseTo(
      first.cost,
      6,
    )
  })

  it('leaves Sessions with no group, and labels one into a group by Label alone', () => {
    const ungrouped = facts.sessionFacts.filter(
      (session) => session.effective.groupId === undefined,
    )
    expect(ungrouped.length).toBeGreaterThan(50)
    const labelled = facts.sessionFacts.filter(
      (session) => session.emitted.groupId === undefined && session.effective.groupId !== undefined,
    )
    expect(labelled).toHaveLength(1)
  })

  describe('the 20 curated Widget requests', () => {
    const today = localDate(tz, demoNow)
    const window = (daysBack: number, tz: string) => ({
      from: zonedTime(tz, addDays(today, -daysBack)).toISOString(),
      to: dayBounds(tz, today).to.toISOString(),
    })

    // The same shape a Widget's `request()` returns (the Dashboard's contract).
    const widgets = (): [string, WidgetRequest][] => {
      const month = window(29, tz)
      const metric = (
        name: string,
        range: { from: string; to: string },
        rest = {},
      ): WidgetRequest => ({
        op: 'queryMetrics',
        body: { metric: `claude_code.${name}`, aggregation: 'sum', ...range, tz, ...rest },
      })
      const event = (name: string, aggregation: object, rest = {}): WidgetRequest => ({
        op: 'queryEvents',
        body: {
          mode: 'aggregate',
          ...month,
          tz,
          filter: [{ key: 'event.name', op: 'eq', value: name }],
          aggregation,
          ...rest,
        } as OperationInput<'queryEvents'>['body'],
      })
      return [
        ['Cost today', metric('cost.usage', facts.today)],
        ['Cost this week', metric('cost.usage', facts.thisWeek)],
        ['Each day by model', metric('cost.usage', month, { bucket: 'day', group_by: ['model'] })],
        ['Cost by Account', metric('cost.usage', month, { group_by: ['embertrail.account_id'] })],
        ['Sessions today', metric('session.count', facts.today)],
        ['Top sessions', { op: 'listSessions', query: { sort: '-cost_usd', limit: 10 } }],
        [
          'Sessions per day',
          metric('session.count', month, { bucket: 'day', group_by: ['start_type'] }),
        ],
        ['Model mix', metric('cost.usage', month, { group_by: ['model'] })],
        ['Cache share', metric('token.usage', month, { group_by: ['type'] })],
        ['Tokens by type', metric('token.usage', month, { bucket: 'day', group_by: ['type'] })],
        [
          'Top tools',
          event(
            'tool_result',
            { fn: 'count' },
            { group_by: ['tool_name'], order: { by: 'value', direction: 'desc' }, limit: 10 },
          ),
        ],
        [
          'Tool failures',
          event('tool_result', { fn: 'count' }, { group_by: ['tool_name', 'success'] }),
        ],
        ['Edit acceptance', metric('code_edit_tool.decision', month, { group_by: ['decision'] })],
        [
          'Lines changed per day',
          metric('lines_of_code.count', month, { bucket: 'day', group_by: ['type'] }),
        ],
        ['Commits per day', metric('commit.count', month, { bucket: 'day' })],
        ['Today by hour vs typical', metric('cost.usage', window(27, tz), { bucket: 'hour' })],
        ['When you work', metric('active_time.total', window(83, tz), { bucket: 'hour' })],
        [
          'Active time per day',
          metric('active_time.total', month, { bucket: 'day', group_by: ['type'] }),
        ],
        [
          'API errors',
          event('api_error', { fn: 'count' }, { bucket: 'hour', group_by: ['status_code'] }),
        ],
        [
          'Request latency',
          event(
            'api_request',
            { fn: 'p95', key: 'duration_ms' },
            { bucket: 'hour', group_by: ['model'] },
          ),
        ],
      ]
    }

    it('are all twenty', () => {
      expect(widgets()).toHaveLength(20)
    })

    it.each(widgets().map(([name], index) => [name, index] as const))(
      '%s finds data',
      async (name, index) => {
        const request = defined(widgets()[index], name)[1]
        const answer =
          request.op === 'queryMetrics'
            ? await hub.client.queryMetrics({ body: request.body })
            : request.op === 'queryEvents'
              ? await hub.client.queryEvents({ body: request.body })
              : await hub.client.listSessions({ query: request.query })
        const found = answer as { rows?: unknown[]; items?: unknown[] }
        expect(
          (found.rows ?? found.items ?? []).length,
          `${name} has data to show`,
        ).toBeGreaterThan(0)
      },
    )
  })
})

describe('a Hub that only a non-Claude sender writes to', () => {
  it('has Sessions and an Inventory, and nothing for a Claude Code Widget', async () => {
    const hub = await dashboardTestHub({ demo: { sender: 'other' } })
    try {
      const inventory = await hub.client.getInventory()
      expect(inventory.services).toEqual(['other-agent'])
      expect(inventory.metrics.map((metric) => metric.name)).not.toContain('claude_code.cost.usage')
      const cost = await hub.client.queryMetrics({
        body: {
          metric: 'claude_code.cost.usage',
          aggregation: 'sum',
          ...defined(hub.demo, 'the dataset').facts.thisWeek,
          tz: 'Europe/Berlin',
        },
      })
      expect(cost.rows.every((row) => row.value === null || row.value === 0)).toBe(true)
    } finally {
      await hub.close()
    }
  }, 120_000)
})
