import type { BoardSummary } from '#features/boards/data/boards'
import type { BoardTeam } from '#features/boards/hooks/useBoardAccess'

export interface BoardSection {
  /** Stable identity: "user" or the Team's id; labels can collide. */
  key: string
  /** "Boards" for a solo User; otherwise "Yours" or the Team's name. */
  label: string
  /** Whether to show the label: a solo User's single list has no heading. */
  heading: boolean
  boards: BoardSummary[]
}

/**
 * The stored Boards grouped by Owner. A solo User (no Teams) gets one unlabelled list; a member of
 * a Team gets "Yours" and a section per Team, in the order the Hub lists their Teams. Sections
 * with no Board are left out.
 */
export function boardSections(
  boards: readonly BoardSummary[],
  teams: readonly BoardTeam[],
): BoardSection[] {
  if (teams.length === 0)
    return [{ key: 'user', label: 'Boards', heading: false, boards: [...boards] }]
  const owned = (id: string | undefined) =>
    boards.filter(({ owner }) => (id === undefined ? owner.kind === 'user' : owner.id === id))
  const known = new Set(teams.map(({ id }) => id))
  const unlisted = new Set(
    boards.flatMap(({ owner }) => (owner.kind === 'team' && !known.has(owner.id) ? owner.id : [])),
  )
  return [
    { key: 'user', label: 'Yours', boards: owned(undefined) },
    ...teams.map(({ id, name }) => ({ key: `team:${id}`, label: name, boards: owned(id) })),
    ...[...unlisted].map((id) => ({ key: `team:${id}`, label: id, boards: owned(id) })),
  ]
    .filter(({ boards: inSection }) => inSection.length > 0)
    .map((section) => ({ ...section, heading: true }))
}
