import { describe, expect, it } from 'vitest'

import type { SessionNode, SessionSummary } from '#features/sessions/types/sessionTree'

import { groupSessions } from './groupSessions'

function session(id: string, over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id,
    service_name: 'claude-code',
    owner_id: 'u1',
    source_id: 's1',
    account_id: null,
    started_at: '2026-11-01T10:00:00Z',
    last_seen_at: '2026-11-01T11:00:00Z',
    models: [],
    cost_usd: 1,
    tokens: { input: 10, output: 5 },
    event_counts: {},
    group: null,
    parent_session_id: null,
    role: null,
    labels: {},
    ...over,
  }
}

const inGroup = (id: string, group: string, over: Partial<SessionSummary> = {}) =>
  session(id, { group: { id: group, kind: 'batch' }, ...over })

const ids = (nodes: SessionNode[]): string[] => nodes.map((node) => node.session.id)

describe('groupSessions', () => {
  it('totals each group from its members and puts the most expensive first', () => {
    const groups = groupSessions([
      inGroup('a', 'cheap', { cost_usd: 1 }),
      inGroup('b', 'dear', { cost_usd: 2.5, tokens: { input: 100 } }),
      inGroup('c', 'dear', { cost_usd: 0.5, tokens: { output: 7, cacheRead: 3 } }),
    ])

    expect(groups.map((group) => group.groupId)).toEqual(['dear', 'cheap'])
    expect(groups[0]).toMatchObject({ sessionCount: 2, cost: 3, tokens: 110, groupKind: 'batch' })
  })

  it('nests a Session under its parent, to any depth, oldest first', () => {
    const [group] = groupSessions([
      inGroup('grandchild', 'g', { parent_session_id: 'child' }),
      inGroup('child-b', 'g', { parent_session_id: 'root', started_at: '2026-11-01T10:20:00Z' }),
      inGroup('child', 'g', { parent_session_id: 'root', started_at: '2026-11-01T10:10:00Z' }),
      inGroup('root', 'g', { started_at: '2026-11-01T09:00:00Z' }),
    ])

    expect(ids(group?.children ?? [])).toEqual(['root'])
    const root = group?.children[0]
    expect(ids(root?.children ?? [])).toEqual(['child', 'child-b'])
    expect(ids(root?.children[0]?.children ?? [])).toEqual(['grandchild'])
  })

  it('makes a Session a root when its parent is not in the group', () => {
    const [group] = groupSessions([
      inGroup('elsewhere-child', 'g', { parent_session_id: 'in-another-group' }),
      inGroup('root', 'g'),
    ])

    expect(ids(group?.children ?? [])).toEqual(['elsewhere-child', 'root'])
  })

  it('keeps the Sessions without a group last, in a "No group" row', () => {
    const groups = groupSessions([
      session('loose', { cost_usd: 99 }),
      session('loose-too', { cost_usd: null, tokens: {} }),
      inGroup('a', 'g', { cost_usd: 1 }),
    ])

    expect(groups.map((group) => group.groupId)).toEqual(['g', null])
    expect(groups[1]).toMatchObject({ sessionCount: 2, cost: 99, tokens: 15, groupKind: null })
  })

  it('shows Sessions that name each other as parents instead of losing them', () => {
    const [group] = groupSessions([
      inGroup('a', 'g', { parent_session_id: 'b' }),
      inGroup('b', 'g', { parent_session_id: 'a' }),
      inGroup('self', 'g', { parent_session_id: 'self' }),
    ])

    const shown = (nodes: SessionNode[]): string[] =>
      nodes.flatMap((node) => [node.session.id, ...shown(node.children)])
    expect(shown(group?.children ?? []).toSorted()).toEqual(['a', 'b', 'self'])
  })

  it('gives every row an id that is unique across the tree', () => {
    const groups = groupSessions([session('x'), inGroup('x', 'g', { owner_id: 'u2' })])
    const all = groups.flatMap((group) => [group.rowId, ...group.children.map((c) => c.rowId)])

    expect(new Set(all).size).toBe(all.length)
  })

  it('has no rows for no Sessions', () => {
    expect(groupSessions([])).toEqual([])
  })
})
