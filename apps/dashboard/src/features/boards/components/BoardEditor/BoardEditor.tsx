import { Alert, Button, Container, Dialog, Heading, Inline, Input, Stack } from '@mitcsutt/kiln-ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useBlocker, useNavigate } from '@tanstack/react-router'
import { useRef, useState } from 'react'

import { AddSectionDialog } from '#features/boards/components/AddSectionDialog'
import { BoardGrid } from '#features/boards/components/BoardGrid'
import { CataloguePicker } from '#features/boards/components/CataloguePicker'
import { ConflictDialog } from '#features/boards/components/ConflictDialog'
import {
  BoardConflict,
  boardQueryOptions,
  deleteBoard,
  saveBoard,
} from '#features/boards/data/boards'
import type { StoredBoard } from '#features/boards/data/boards'
import type { BoardDocument } from '#features/boards/types/board'
import {
  addSectionItem,
  addWidgetItem,
  removeBoardItem,
  sameBoard,
  setItemOverride,
  withFilters,
  withLayout,
} from '#features/boards/utils/editBoard'
import { FilterBar } from '#features/filters/components/FilterBar'
import { useInventory } from '#features/filters/data/inventory'
import { useBoardFilters } from '#features/filters/hooks/useBoardFilters'
import { useResolvedWindow } from '#features/filters/hooks/useResolvedWindow'
import { WidgetColorScope } from '#features/widgets/components/WidgetColorScope'
import { useHub } from '#lib/hub'

export interface BoardEditorProps {
  stored: StoredBoard
  /** Leaves edit mode: after a save, a Cancel, or a Reload. */
  onExit: () => void
}

/**
 * One stored Board in edit mode. The Board is copied into a draft that Save writes back on the
 * version it was read at (`If-Match`); until then nothing is stored. Add, remove, move, resize and
 * pinned filters change the draft. A save that loses to another change opens the conflict dialog
 * and never overwrites; leaving with unsaved changes asks first.
 */
export function BoardEditor({ stored: opened, onExit: exit }: BoardEditorProps) {
  const { client } = useHub()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [stored] = useState(opened)
  const [draft, setDraft] = useState<BoardDocument>(stored.board)
  const dirty = !sameBoard(draft, stored.board)
  const { filters, setFilters, tz } = useBoardFilters(draft.filters)
  const [now] = useState(() => new Date())
  const window = useResolvedWindow(filters.time, now, tz)
  const inventory = useInventory(client, window)

  const [picking, setPicking] = useState(false)
  const [sectioning, setSectioning] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [conflict, setConflict] = useState<BoardConflict>()
  const [handles] = useState(() => new Map<string, HTMLButtonElement>())
  const added = useRef<string>(undefined)
  const leaving = useRef(false)
  const onExit = () => {
    leaving.current = true
    exit()
  }

  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) =>
      dirty &&
      !leaving.current &&
      (current.pathname !== next.pathname || (next.search as { edit?: unknown }).edit !== true),
    enableBeforeUnload: () => dirty && !leaving.current,
    withResolver: true,
  })

  const goToOverview = () => {
    leaving.current = true
    void navigate({ to: '/boards/$boardId', params: { boardId: 'overview' } })
  }
  const forgetBoard = () => {
    queryClient.removeQueries({ queryKey: boardQueryOptions(client, stored.id).queryKey })
    void queryClient.invalidateQueries({ queryKey: ['boards', 'list'] })
  }

  const save = useMutation({
    mutationFn: () => saveBoard(client, stored.id, draft, stored.etag),
    onSuccess: (saved) => {
      queryClient.setQueryData(boardQueryOptions(client, stored.id).queryKey, saved)
      void queryClient.invalidateQueries({ queryKey: ['boards', 'list'] })
      onExit()
    },
    onError: (error) => {
      if (error instanceof BoardConflict) setConflict(error)
    },
  })

  const remove = useMutation({
    mutationFn: () => deleteBoard(client, stored.id, stored.etag),
    onSuccess: () => {
      forgetBoard()
      goToOverview()
    },
    onError: (error) => {
      setDeleting(false)
      if (error instanceof BoardConflict) setConflict(error)
    },
  })

  const reload = () => {
    const current = conflict?.current
    setConflict(undefined)
    if (current !== undefined) {
      queryClient.setQueryData(boardQueryOptions(client, stored.id).queryKey, current)
      void queryClient.invalidateQueries({ queryKey: ['boards', 'list'] })
      onExit()
    } else if (conflict?.cause === undefined) {
      forgetBoard()
      goToOverview()
    } else {
      void queryClient.invalidateQueries({
        queryKey: boardQueryOptions(client, stored.id).queryKey,
      })
      onExit()
    }
  }

  const error = save.error ?? remove.error ?? undefined
  const failure = error instanceof BoardConflict ? undefined : error

  return (
    <Container width="full">
      <Stack gap={4}>
        <Inline justify="between" align="end" gap={3}>
          <Stack gap={2}>
            <Heading level={1} size="2xl">
              Edit Board
            </Heading>
            <Input
              aria-label="Board name"
              maxLength={200}
              value={draft.name}
              onChange={(event) => {
                setDraft({ ...draft, name: event.target.value })
              }}
            />
          </Stack>
          <Inline gap={2} role="toolbar" aria-label="Board actions">
            <Button
              variant="outline"
              onClick={() => {
                setPicking(true)
              }}
            >
              Add Widget
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setSectioning(true)
              }}
            >
              Add section
            </Button>
            <Button
              variant="outline"
              disabled={sameBoard(withFilters(draft, filters), draft)}
              onClick={() => {
                setDraft(withFilters(draft, filters))
              }}
            >
              Use these filters as the default
            </Button>
            <Button
              variant="outline"
              tone="critical"
              onClick={() => {
                setDeleting(true)
              }}
            >
              Delete Board
            </Button>
            <Button variant="outline" onClick={onExit}>
              Cancel
            </Button>
            <Button
              disabled={!dirty || draft.name.trim() === '' || save.isPending}
              onClick={() => {
                save.mutate()
              }}
            >
              Save
            </Button>
          </Inline>
        </Inline>
        {failure === undefined ? null : (
          <Alert tone="critical" title="That did not work">
            {failure instanceof Error ? failure.message : 'The Hub did not answer.'}
          </Alert>
        )}
        <FilterBar
          filters={filters}
          onChange={setFilters}
          inventory={inventory.data}
          loading={inventory.isPending}
          tz={tz}
          now={now}
        />
        <WidgetColorScope models={inventory.data?.models ?? []}>
          <BoardGrid
            board={draft}
            filters={filters}
            now={now}
            tz={tz}
            edit={{
              onLayoutChange: (layout) => {
                setDraft((current) => withLayout(current, layout))
              },
              onRemove: (id) => {
                setDraft((current) => removeBoardItem(current, id))
              },
              onOverrideChange: (id, override) => {
                setDraft((current) => setItemOverride(current, id, override))
              },
              inventory: inventory.data,
              handles,
            }}
          />
        </WidgetColorScope>
      </Stack>

      <CataloguePicker
        open={picking}
        onOpenChange={setPicking}
        onAdd={(widget) => {
          const result = addWidgetItem(draft, widget)
          setDraft(result.board)
          added.current = result.id
          setPicking(false)
        }}
        onCloseAutoFocus={(event) => {
          const id = added.current
          added.current = undefined
          if (id === undefined) return
          event.preventDefault()
          handles.get(id)?.focus()
        }}
      />
      <AddSectionDialog
        open={sectioning}
        onOpenChange={setSectioning}
        onAdd={(title) => {
          setDraft(addSectionItem(draft, title).board)
          setSectioning(false)
        }}
      />
      <Dialog open={deleting} onOpenChange={setDeleting}>
        <Dialog.Content
          title="Delete this Board?"
          description={`"${stored.board.name}" is removed for good.`}
          size="sm"
          hideClose
        >
          <Dialog.Footer>
            <Dialog.Close asChild>
              <Button variant="outline">Keep it</Button>
            </Dialog.Close>
            <Button
              tone="critical"
              disabled={remove.isPending}
              onClick={() => {
                remove.mutate()
              }}
            >
              Delete Board
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>
      <ConflictDialog
        conflict={conflict}
        onReload={reload}
        onKeepEditing={() => {
          setConflict(undefined)
        }}
      />
      <Dialog
        open={blocker.status === 'blocked'}
        onOpenChange={(open) => {
          if (!open && blocker.status === 'blocked') blocker.reset()
        }}
      >
        <Dialog.Content
          title="Discard your changes?"
          description="This Board has changes that are not saved."
          size="sm"
          hideClose
        >
          <Dialog.Footer>
            <Button
              variant="outline"
              onClick={() => {
                if (blocker.status === 'blocked') blocker.reset()
              }}
            >
              Keep editing
            </Button>
            <Button
              tone="critical"
              onClick={() => {
                if (blocker.status === 'blocked') blocker.proceed()
              }}
            >
              Discard changes
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>
    </Container>
  )
}
