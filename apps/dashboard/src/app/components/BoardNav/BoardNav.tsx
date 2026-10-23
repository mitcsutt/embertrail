import { NavLinks } from '@mitcsutt/kiln-ui'
import { Link, useParams } from '@tanstack/react-router'

import { useBoardList } from '#features/boards/data/boards'
import { presetSummaries } from '#features/boards/constants/presetSummaries'
import { useHub } from '#lib/hub'

/**
 * The Presets and the stored Boards, as links. "New Board" is the empty Preset: Customise on it
 * starts a Board of one's own. A Hub that refuses the Board list shows the Presets alone.
 */
export function BoardNav() {
  const { client } = useHub()
  const { data } = useBoardList(client)
  const current = useParams({ strict: false }).boardId
  const presets = presetSummaries.filter(({ id }) => id !== 'new')
  const newBoard = presetSummaries.find(({ id }) => id === 'new')

  return (
    <NavLinks label="Board list" orientation="vertical" size="sm">
      {[...presets, ...(data?.boards ?? []), ...(newBoard === undefined ? [] : [newBoard])].map(
        ({ id, name }) => (
          <NavLinks.Item key={id} asChild active={current === id}>
            <Link to="/boards/$boardId" params={{ boardId: id }}>
              {name}
            </Link>
          </NavLinks.Item>
        ),
      )}
    </NavLinks>
  )
}
