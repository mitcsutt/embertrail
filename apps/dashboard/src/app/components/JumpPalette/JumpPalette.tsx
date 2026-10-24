import { CommandPalette, Kbd, SearchIcon } from '@mitcsutt/kiln-ui'
import type { CommandAction } from '@mitcsutt/kiln-ui'
import { useNavigate } from '@tanstack/react-router'
import { forwardRef, useMemo, type ButtonHTMLAttributes } from 'react'

import { useBoardList } from '#features/boards/data/boards'
import { useBoardSections } from '#features/boards/hooks/useBoardSections'
import { usePresetList } from '#features/boards/hooks/usePresetList'
import { useHub } from '#lib/hub'

import styles from './JumpPalette.module.css'

const isApple = (): boolean =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/**
 * The palette's trigger, drawn as a search field so it reads as one: an icon, the placeholder and
 * the shortcut. Below `sm` the text and shortcut give way to the icon alone.
 */
const SearchTrigger = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  function SearchTrigger(props, ref) {
    const apple = isApple()
    return (
      <button
        ref={ref}
        type="button"
        className={styles.trigger}
        aria-label="Jump to"
        aria-keyshortcuts="Control+K Meta+K"
        {...props}
      >
        <SearchIcon aria-hidden />
        <span className={styles.placeholder}>Jump to…</span>
        <span className={styles.shortcut} aria-hidden>
          <Kbd size="sm">{apple ? '⌘' : 'Ctrl'}</Kbd>
          <Kbd size="sm">K</Kbd>
        </span>
      </button>
    )
  },
)

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
      trigger={<SearchTrigger />}
    />
  )
}
