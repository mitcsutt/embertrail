// @vitest-environment node

// The Session Groups view's data against the demo dataset on a real Hub: a group's totals equal
// the sum of the Sessions listed under it, a Label moves a Session to another group, the tree is
// three levels deep, and a Session's Events page through the cursor.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { toQueryContext } from '#features/filters/utils/toQueryContext'
import { fetchEventsPage, sessionSpan } from '#features/sessions/data/session'
import { fetchSessions } from '#features/sessions/data/sessionGroups'
import type { GroupNode, SessionNode } from '#features/sessions/types/sessionTree'
import { groupSessions } from '#features/sessions/utils/groupSessions'
import type { WidgetRequest } from '#features/widgets/types/widget'

import { demoNow } from './demo/index.ts'
import { dashboardTestHub } from './hub.ts'
import type { DashboardTestHub } from './hub.ts'
import { assertSpecRequest } from './spec.ts'

const tz = 'Europe/Berlin'
const everything = { window: 'board', filters: ['source', 'account', 'model'] } as const

let hub: DashboardTestHub
beforeAll(async () => {
  // Labels are held back so the first test sees the groups as the Sessions sent them; the rest run
  // after it has applied them, which is the state the generator's group facts describe.
  hub = await dashboardTestHub({ labels: false })
})
afterAll(async () => {
  await hub.close()
})

function windowFor(filters = {}) {
  const ctx = toQueryContext(
    { time: { kind: 'relative', range: 'last-90-days' }, ...filters },
    undefined,
    everything,
    demoNow,
    tz,
  )
  return { from: ctx.from, to: ctx.to, sessions: ctx.sessions }
}

const members = (node: GroupNode | SessionNode): SessionNode[] =>
  node.children.flatMap((child) => [child, ...members(child)])
const depth = (nodes: SessionNode[]): number =>
  nodes.length === 0 ? 0 : 1 + Math.max(...nodes.map((node) => depth(node.children)))
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)

describe('the Session Groups data', () => {
  it('moves a Session to another group when a Label regroups it', async () => {
    const moved = hub.demo?.facts.relabelled
    expect(moved).toBeDefined()
    if (moved === undefined) return
    const groupOf = async () =>
      groupSessions(await fetchSessions(hub.client, windowFor())).find((group) =>
        members(group).some((node) => node.session.id === moved.sessionId),
      )?.groupId

    expect(await groupOf()).toBe(moved.from)
    await hub.applyLabels()
    expect(await groupOf()).toBe(moved.to)
  })

  it('lists every Session of the window', async () => {
    const sessions = await fetchSessions(hub.client, windowFor())

    expect(sessions).toHaveLength(hub.demo?.facts.sessions ?? -1)
  })

  it('totals each group as the sum of its Sessions, and matches the generator', async () => {
    const groups = groupSessions(await fetchSessions(hub.client, windowFor()))
    const facts = hub.demo?.facts.groups ?? []
    expect(facts.length).toBeGreaterThan(0)

    for (const fact of facts) {
      const group = groups.find((candidate) => candidate.groupId === fact.id)
      const all = group === undefined ? [] : members(group)
      expect(all.map((node) => node.session.id).toSorted()).toEqual(fact.sessionIds.toSorted())
      expect(group?.sessionCount).toBe(all.length)
      // The group's total is the members' own sums, to the cent, not a second query's idea of them.
      expect(group?.cost).toBeCloseTo(sum(all.map((node) => node.session.cost_usd ?? 0)), 9)
      expect(group?.tokens).toBe(sum(all.flatMap((node) => Object.values(node.session.tokens))))
      expect(group?.cost).toBeCloseTo(fact.cost, 4)
      expect(group?.children.map((root) => root.session.id).toSorted()).toEqual(
        fact.rootIds.toSorted(),
      )
      expect(depth(group?.children ?? [])).toBe(fact.depth)
    }
    expect(Math.max(...facts.map((fact) => fact.depth))).toBe(3)
  })

  it('counts every Session once, in a group or in "No group"', async () => {
    const sessions = await fetchSessions(hub.client, windowFor())
    const groups = groupSessions(sessions)

    expect(sum(groups.map((group) => group.sessionCount))).toBe(sessions.length)
    expect(groups.at(-1)?.groupId).toBeNull()
  })

  it('narrows to a filter the way the bar does', async () => {
    const sessions = await fetchSessions(hub.client, windowFor({ model: 'claude-haiku-4-5' }))

    expect(sessions.length).toBeGreaterThan(0)
    expect(sessions.length).toBeLessThan(hub.demo?.facts.sessions ?? 0)
    expect(sessions.every((session) => session.models.includes('claude-haiku-4-5'))).toBe(true)
  })
})

describe('a Session and its Events', () => {
  it('pages through every Event once, oldest first, by cursor', async () => {
    const [busiest] = (await fetchSessions(hub.client, windowFor())).toSorted(
      (a, b) => sum(Object.values(b.event_counts)) - sum(Object.values(a.event_counts)),
    )
    if (busiest === undefined) throw new Error('the demo dataset has no Sessions')
    const detail = await hub.client.getSession({ path: { session_id: busiest.id } })
    const span = sessionSpan(detail)
    if (span === undefined) throw new Error('the Session has no span')
    const total = sum(Object.values(detail.event_counts))
    expect(total).toBeGreaterThan(100)

    const events = []
    let cursor: string | undefined
    let pages = 0
    do {
      const page = await fetchEventsPage(hub.client, busiest.id, span, tz, cursor)
      events.push(...page.items)
      cursor = page.next_cursor ?? undefined
      pages += 1
    } while (cursor !== undefined)

    expect(pages).toBeGreaterThan(1)
    expect(events).toHaveLength(total)
    expect(new Set(events.map((event) => event.session_id))).toEqual(new Set([busiest.id]))
    const times = events.map((event) => event.time)
    expect(times).toEqual(times.toSorted())
  })

  it('asks for Events with a request the spec accepts', () => {
    const request: WidgetRequest = {
      op: 'queryEvents',
      body: {
        mode: 'list',
        from: '2026-11-01T00:00:00.000Z',
        to: '2026-11-02T00:00:00.000Z',
        tz,
        filter: [{ key: 'session.id', op: 'eq', value: 'abc' }],
        order: 'asc',
        limit: 100,
      },
    }
    expect(() => {
      assertSpecRequest(request)
    }).not.toThrow()
  })

  it('lists a Session together with the Sessions that name it as parent', async () => {
    const group = hub.demo?.facts.groups.find((candidate) => candidate.depth === 3)
    const root = group?.rootIds[0]
    if (root === undefined) throw new Error('the demo dataset has no deep group')

    const detail = await hub.client.getSession({ path: { session_id: root } })
    const tree = groupSessions(await fetchSessions(hub.client, windowFor()))
      .flatMap((candidate) => members(candidate))
      .find((node) => node.session.id === root)

    expect(detail.children.map((child) => child.id).toSorted()).toEqual(
      tree?.children.map((child) => child.session.id).toSorted(),
    )
  })
})
