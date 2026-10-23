import { Alert, Button, Container, EmptyState, Heading, Inline, Stack } from '@mitcsutt/kiln-ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

import { BoardEditor } from '#features/boards/components/BoardEditor'
import { BoardGrid } from '#features/boards/components/BoardGrid'
import { boardQueryOptions, createBoard } from '#features/boards/data/boards'
import type { StoredBoard } from '#features/boards/data/boards'
import { useEditMode } from '#features/boards/hooks/useEditMode'
import type { BoardDocument } from '#features/boards/types/board'
import { customisePreset } from '#features/boards/utils/presets'
import { FilterBar } from '#features/filters/components/FilterBar'
import { useInventory } from '#features/filters/data/inventory'
import { useBoardFilters } from '#features/filters/hooks/useBoardFilters'
import { useResolvedWindow } from '#features/filters/hooks/useResolvedWindow'
import { WidgetColorScope } from '#features/widgets/components/WidgetColorScope'
import { useHub, useSelf } from '#lib/hub'

export interface BoardViewProps {
  board: BoardDocument
  /** A Preset is customised into a Board of one's own; a stored Board is edited. */
  preset: boolean
  /** The stored Board behind `board`, with the version to save against; unset for a Preset. */
  stored?: StoredBoard
}

/**
 * One Board: in view mode its name, the filter bar and the grid, with one colour per model across
 * every chart (the filters live in the URL over the Board's saved ones); in edit mode, the editor.
 * "Edit" opens a stored Board in the editor. "Customise" stores a copy of a Preset and opens that.
 * Without `store:write` neither is offered, and `?edit` is ignored.
 */
export function BoardView({ board, preset, stored }: BoardViewProps) {
  const { canEdit } = useSelf()
  const { editing, setEditing } = useEditMode()
  if (canEdit && editing && stored !== undefined) {
    return (
      <BoardEditor
        stored={stored}
        onExit={() => {
          setEditing(false)
        }}
      />
    )
  }
  return (
    <ViewedBoard
      board={board}
      preset={preset}
      canEdit={canEdit}
      onEdit={() => {
        setEditing(true)
      }}
    />
  )
}

interface ViewedBoardProps {
  board: BoardDocument
  preset: boolean
  canEdit: boolean
  onEdit: () => void
}

function ViewedBoard({ board, preset, canEdit, onEdit }: ViewedBoardProps) {
  const { client } = useHub()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { filters, setFilters, tz } = useBoardFilters(board.filters)
  const [now] = useState(() => new Date())
  const window = useResolvedWindow(filters.time, now, tz)
  const inventory = useInventory(client, window)

  // The copy keeps what is on screen: the Preset's Widgets under the filters in force.
  const customise = useMutation({
    mutationFn: () => createBoard(client, { ...customisePreset(board), filters }),
    onSuccess: (created) => {
      queryClient.setQueryData(boardQueryOptions(client, created.id).queryKey, created)
      void queryClient.invalidateQueries({ queryKey: ['boards', 'list'] })
      void navigate({
        to: '/boards/$boardId',
        params: { boardId: created.id },
        search: { edit: true },
      })
    },
  })

  return (
    <Container width="full">
      <Stack gap={4}>
        <Inline justify="between" align="center">
          <Heading level={1} size="2xl">
            {board.name}
          </Heading>
          {canEdit ? (
            <Button
              variant="outline"
              loading={customise.isPending}
              onClick={
                preset
                  ? () => {
                      customise.mutate()
                    }
                  : onEdit
              }
            >
              {preset ? 'Customise' : 'Edit'}
            </Button>
          ) : null}
        </Inline>
        {customise.isError ? (
          <Alert tone="critical" title="Could not customise this Board">
            {customise.error instanceof Error ? customise.error.message : 'The Hub did not answer.'}
          </Alert>
        ) : null}
        <FilterBar
          filters={filters}
          onChange={setFilters}
          inventory={inventory.data}
          loading={inventory.isPending}
          tz={tz}
          now={now}
        />
        {board.items.length === 0 ? (
          <EmptyState
            title="No Widgets on this Board yet"
            description="Add Widgets from the Catalogue in edit mode."
          />
        ) : (
          <WidgetColorScope models={inventory.data?.models ?? []}>
            <BoardGrid board={board} filters={filters} now={now} tz={tz} />
          </WidgetColorScope>
        )}
      </Stack>
    </Container>
  )
}
