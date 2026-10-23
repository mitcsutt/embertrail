import type { GroupNode, SessionNode, SessionSummary } from '#features/sessions/types/sessionTree'

/** Oldest first; a Session known only from its Labels has no start and goes last. */
const byStart = (a: SessionSummary, b: SessionSummary) => {
  if (a.started_at !== b.started_at) {
    if (a.started_at === null) return 1
    if (b.started_at === null) return -1
    return a.started_at.localeCompare(b.started_at)
  }
  return a.id.localeCompare(b.id)
}

const sum = (values: Iterable<number>) => {
  let total = 0
  for (const value of values) total += value
  return total
}

function buildGroup(groupId: string | null, members: SessionSummary[]): GroupNode {
  const ids = new Set(members.map((member) => member.id))
  const rowId = groupId === null ? 'ungrouped' : `group/${groupId}`
  const children = new Map<string, SessionSummary[]>()
  const roots: SessionSummary[] = []
  for (const member of [...members].sort(byStart)) {
    const parent = member.parent_session_id
    if (parent !== null && parent !== member.id && ids.has(parent)) {
      children.set(parent, [...(children.get(parent) ?? []), member])
    } else {
      roots.push(member)
    }
  }

  const placed = new Set<string>()
  const node = (session: SessionSummary): SessionNode => {
    placed.add(session.id)
    return {
      kind: 'session',
      rowId: `session/${rowId}/${session.id}`,
      session,
      // A Session already placed is skipped, which is what ends a loop of parents.
      children: (children.get(session.id) ?? []).filter((c) => !placed.has(c.id)).map(node),
    }
  }
  const rootNodes = roots.map(node)
  // Parents that point at each other have no root above them; show them rather than lose them.
  for (const member of [...members].sort(byStart)) {
    if (!placed.has(member.id)) rootNodes.push(node(member))
  }

  return {
    kind: 'group',
    rowId,
    groupId,
    groupKind: members.find((member) => member.group?.kind)?.group?.kind ?? null,
    sessionCount: members.length,
    cost: sum(members.map((member) => member.cost_usd ?? 0)),
    tokens: sum(members.flatMap((member) => Object.values(member.tokens))),
    children: rootNodes,
  }
}

/**
 * Arranges Sessions into Session Groups: one row per `embertrail.group.id`, the most expensive
 * first, then a "No group" row for the Sessions without one. Inside a group a Session sits under
 * its parent when the parent is in the same group, and is a root otherwise. A group's totals are
 * the sums of its members' own `cost_usd` and tokens, so they equal what the Sessions list shows.
 */
export function groupSessions(sessions: readonly SessionSummary[]): GroupNode[] {
  const buckets = new Map<string | null, SessionSummary[]>()
  for (const session of sessions) {
    const key = session.group?.id ?? null
    buckets.set(key, [...(buckets.get(key) ?? []), session])
  }
  const groups = [...buckets].map(([groupId, members]) => buildGroup(groupId, members))
  return groups.sort((a, b) => {
    if (a.groupId === null) return 1
    if (b.groupId === null) return -1
    return b.cost - a.cost || a.groupId.localeCompare(b.groupId)
  })
}
