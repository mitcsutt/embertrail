import type { Schemas } from '@mitcsutt/embertrail-client'

import type { StoredBoard } from '#features/boards/data/boards'
import { useSelf } from '#lib/hub'

export type BoardTeam = Schemas['Self']['teams'][number]

const noTeams: readonly BoardTeam[] = []

export interface BoardAccess {
  /** The Teams the caller belongs to; empty for a solo User, who is shown nothing about Teams. */
  teams: readonly BoardTeam[]
  /** The Teams whose Boards the caller may write, and so may own a new Board. */
  editorTeams: readonly BoardTeam[]
  /** Whether the Token may write Boards at all (`store:write`). */
  canCreate: boolean
  /** Whether the caller may save or delete a Board with this Owner. */
  canWrite: (owner: StoredBoard['owner']) => boolean
}

/**
 * What the caller may do with Boards, from `getSelf`: their own, and those of the Teams they edit.
 * A Hub that errors leaves the write itself to report a refusal, as `useSelf` does; until it
 * answers, a Team's Board is read-only.
 */
export function useBoardAccess(): BoardAccess {
  const { self, canEdit, pending } = useSelf()
  const teams = self?.teams ?? noTeams
  return {
    teams,
    editorTeams: teams.filter(({ editor }) => editor),
    canCreate: canEdit,
    canWrite: (owner) =>
      canEdit &&
      (owner.kind === 'user' ||
        (self === undefined && !pending) ||
        teams.some(({ id, editor }) => id === owner.id && editor)),
  }
}
