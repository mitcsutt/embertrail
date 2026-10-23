import { Button, CommandPalette } from '@mitcsutt/kiln-ui'
import type { CommandAction } from '@mitcsutt/kiln-ui'
import { useNavigate } from '@tanstack/react-router'
import { useMemo } from 'react'

import { useBoardList } from '#features/boards/data/boards'
import { useBoardSections } from '#features/boards/hooks/useBoardSections'
import { usePresetList } from '#features/boards/hooks/usePresetList'
import { useHub } from '#lib/hub'

/** ⌘K (Ctrl+K elsewhere): jump to any Board, or to the Session Groups. */
export function JumpPalette() {
  const { client } = useHub()
  const { data } = useBoardList(client)
  const sections = useBoardSections(data?.boards)
  const presets = usePresetList()
  const navigate = useNavigate()

  const actions = useMemo<CommandAction[]>(() => {
    const board = (id: string, name: string, group: string): CommandAction => ({
      id: `board:${id}`,
      label: name,
      group,
      onSelect: () => {
        void navigate({ to: '/boards/$boardId', params: { boardId: id } })
      },
    })
    return [
      ...presets.map(({ id, name }) => board(id, name, 'Presets')),
      ...sections.flatMap(({ label, boards }) =>
        boards.map(({ id, name }) => board(id, name, label)),
      ),
      {
        id: 'sessions',
        label: 'Session Groups',
        group: 'Pages',
        onSelect: () => {
          void navigate({ to: '/sessions' })
        },
      },
    ]
  }, [sections, presets, navigate])

  return (
    <CommandPalette
      shortcut="mod+k"
      label="Jump to"
      placeholder="Jump to a Board or page"
      actions={actions}
      trigger={
        <Button variant="ghost" size="sm" aria-keyshortcuts="Control+K Meta+K">
          Jump to…
        </Button>
      }
    />
  )
}
