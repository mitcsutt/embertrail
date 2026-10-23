import { NavLinks, Stack, Text } from '@mitcsutt/kiln-ui'
import { Link, useParams } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { useBoardList } from '#features/boards/data/boards'
import { useBoardSections } from '#features/boards/hooks/useBoardSections'
import { usePresetList } from '#features/boards/hooks/usePresetList'
import { useHub } from '#lib/hub'

/**
 * The Presets and the stored Boards, as links. "New Board" is the empty Preset: Customise on it
 * starts a Board of one's own. A member of a Team sees the stored Boards under "Yours" and a
 * heading per Team; a solo User sees one list. A Hub that refuses the Board list shows the Presets
 * alone.
 */
export function BoardNav() {
  const { client } = useHub()
  const { data } = useBoardList(client)
  const current = useParams({ strict: false }).boardId
  const allPresets = usePresetList()
  const presets = allPresets.filter(({ id }) => id !== 'new')
  const newBoard = allPresets.filter(({ id }) => id === 'new')

  const list = (label: string, boards: { id: string; name: string }[]): ReactNode => (
    <NavLinks label={label} orientation="vertical" size="sm">
      {boards.map(({ id, name }) => (
        <NavLinks.Item key={id} asChild active={current === id}>
          <Link to="/boards/$boardId" params={{ boardId: id }}>
            {name}
          </Link>
        </NavLinks.Item>
      ))}
    </NavLinks>
  )

  const sections = useBoardSections(data?.boards)
  if (!sections.some(({ heading }) => heading)) {
    return list('Board list', [
      ...presets,
      ...sections.flatMap(({ boards }) => boards),
      ...newBoard,
    ])
  }
  return (
    <Stack gap={3}>
      {list('Presets', presets)}
      {sections.map(({ key, label, boards }) => (
        <Stack key={key} gap={1}>
          <Text size="xs" tone="muted">
            {label}
          </Text>
          {list(label, boards)}
        </Stack>
      ))}
      {list('New Board', newBoard)}
    </Stack>
  )
}
