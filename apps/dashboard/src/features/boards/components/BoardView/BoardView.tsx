import {
  Alert,
  Button,
  Container,
  EmptyState,
  Inline,
  Select,
  Stack,
  Text,
} from '@mitcsutt/kiln-ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

import { PageHeader } from '#components/PageHeader'
import { BoardEditor } from '#features/boards/components/BoardEditor'
import { BoardGrid } from '#features/boards/components/BoardGrid'
import { boardQueryOptions, createBoard, teamOf } from '#features/boards/data/boards'
import type { StoredBoard } from '#features/boards/data/boards'
import { useBoardAccess } from '#features/boards/hooks/useBoardAccess'
import { useEditMode } from '#features/boards/hooks/useEditMode'
import type { BoardDocument } from '#features/boards/types/board'
import { customisePreset } from '#features/boards/utils/presets'
import { FilterBar } from '#features/filters/components/FilterBar'
import { useInventory } from '#features/filters/data/inventory'
import { useBoardFilters } from '#features/filters/hooks/useBoardFilters'
import { useResolvedWindow } from '#features/filters/hooks/useResolvedWindow'
import { WidgetColorScope } from '#features/widgets/components/WidgetColorScope'
import { useHub } from '#lib/hub'

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
 * "Edit" opens a stored Board in the editor. "Customise" stores a copy of a Preset, or of a Team's
 * Board the caller may not write, and opens that. Without `store:write`, or for a Team's Board of
 * which the caller is not an editor, a Board cannot be edited and `?edit` is ignored.
 */
export function BoardView({ board, preset, stored }: BoardViewProps) {
  const { canCreate, canWrite } = useBoardAccess()
  const { editing, setEditing } = useEditMode()
  const writable = stored !== undefined && canWrite(stored.owner)
  if (stored !== undefined && writable && editing) {
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
      stored={stored}
      canCreate={canCreate}
      writable={writable}
      onEdit={() => {
        setEditing(true)
      }}
    />
  )
}

interface ViewedBoardProps {
  board: BoardDocument
  preset: boolean
  stored: StoredBoard | undefined
  canCreate: boolean
  /** Whether the caller may edit this Board, not only create their own. */
  writable: boolean
  onEdit: () => void
}

/** The Owner choice for a new Board: the caller, or a Team they edit by its id. A Team id has no `:`. */
const mine = ':me'

function ViewedBoard({ board, preset, stored, canCreate, writable, onEdit }: ViewedBoardProps) {
  const { client } = useHub()
  const { teams, editorTeams } = useBoardAccess()
  const [owner, setOwner] = useState(mine)
  const owning = teams.find(({ id }) => stored !== undefined && teamOf(stored.owner) === id)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { filters, setFilters, tz } = useBoardFilters(board.filters)
  const [now] = useState(() => new Date())
  const window = useResolvedWindow(filters.time, now, tz)
  const inventory = useInventory(client, window)

  // The copy keeps what is on screen: the Preset's Widgets under the filters in force.
  const customise = useMutation({
    mutationFn: () =>
      createBoard(
        client,
        { ...customisePreset(board), filters },
        // Only a Preset is copied into a Team's Boards; a copy of a Team's Board is the caller's own.
        { team: preset && owner !== mine ? owner : undefined },
      ),
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
        <PageHeader
          title={board.name}
          description="Your agents' spend and usage for the filters below."
          actions={
            canCreate ? (
              <Inline gap={2} align="center">
                {preset && editorTeams.length > 0 ? (
                  <Select
                    aria-label="Owner"
                    options={[
                      { value: mine, label: 'Yours' },
                      ...editorTeams.map(({ id, name }) => ({
                        value: id,
                        label: `${name} (Team)`,
                      })),
                    ]}
                    value={owner}
                    onValueChange={setOwner}
                  />
                ) : null}
                <Button
                  variant="outline"
                  loading={customise.isPending}
                  onClick={
                    writable
                      ? onEdit
                      : () => {
                          customise.mutate()
                        }
                  }
                >
                  {writable ? 'Edit' : 'Customise'}
                </Button>
              </Inline>
            ) : undefined
          }
        />
        {owning !== undefined && canCreate && !writable ? (
          <Text size="sm" tone="muted">
            {owning.name} owns this Board and you cannot edit it. Customise copies it into your own
            Boards.
          </Text>
        ) : null}
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
