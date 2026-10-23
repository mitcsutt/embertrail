import { useMemo } from 'react'

import type { BoardSummary } from '#features/boards/data/boards'
import { useBoardAccess } from '#features/boards/hooks/useBoardAccess'
import { boardSections } from '#features/boards/utils/boardSections'

/** The stored Boards grouped for navigation: one list for a solo User, by Owner for a Team's member. */
export function useBoardSections(boards: readonly BoardSummary[] | undefined) {
  const { teams } = useBoardAccess()
  return useMemo(() => boardSections(boards ?? [], teams), [boards, teams])
}
