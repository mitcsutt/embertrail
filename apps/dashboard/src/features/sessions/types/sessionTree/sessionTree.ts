import type { Schemas } from '@mitcsutt/embertrail-client'

export type SessionSummary = Schemas['SessionSummary']

/** One Session in a Session Group's tree, with the Sessions that name it as their parent. */
export interface SessionNode {
  kind: 'session'
  /** Unique across the whole tree: the same Session cannot appear twice, but its id could repeat across groups. */
  rowId: string
  session: SessionSummary
  children: SessionNode[]
}

/** One Session Group, or the "No group" row (`groupId` null), with its totals and root Sessions. */
export interface GroupNode {
  kind: 'group'
  rowId: string
  /** `embertrail.group.id`; null for the Sessions that belong to no group. */
  groupId: string | null
  groupKind: string | null
  /** Every member, however deep. */
  sessionCount: number
  /** The members' `cost_usd`, nulls counting as nothing. */
  cost: number
  /** The members' tokens of every type. */
  tokens: number
  /** Members whose parent is not in the group. */
  children: SessionNode[]
}

export type TreeNode = GroupNode | SessionNode
