import { isProblemError } from '@mitcsutt/embertrail-client'
import { Alert, Button, Container, EmptyState, Skeleton } from '@mitcsutt/kiln-ui'
import { Link, useParams } from '@tanstack/react-router'
import { useMemo } from 'react'

import { useBoard } from '#features/boards/data/boards'
import { BoardView } from '#features/boards/components/BoardView'
import { isPresetId, presetBoard } from '#features/boards/utils/presets'
import type { PresetId } from '#features/boards/utils/presets'
import { catalogue } from '#features/widgets/constants/catalogue'
import { useHub } from '#lib/hub'

function PresetBoard({ id }: { id: PresetId }) {
  const board = useMemo(() => presetBoard(id, catalogue), [id])
  return <BoardView key={id} board={board} preset />
}

function StoredBoard({ id }: { id: string }) {
  const { client } = useHub()
  const { data, error, status, refetch } = useBoard(client, id)

  if (status === 'pending') {
    return (
      <Container width="full">
        <Skeleton aria-label="Loading the Board" height="block" />
      </Container>
    )
  }
  if (status === 'error') {
    if (isProblemError(error) && error.status === 404) {
      return (
        <Container width="narrow">
          <EmptyState
            title="No such Board"
            description="It may have been deleted, or the link is wrong."
            action={
              <Button asChild variant="outline">
                <Link to="/boards/$boardId" params={{ boardId: 'overview' }}>
                  Go to the Overview
                </Link>
              </Button>
            }
          />
        </Container>
      )
    }
    return (
      <Container width="narrow">
        <Alert
          tone="critical"
          title="This Board cannot be shown"
          action={
            <Button size="sm" variant="outline" onClick={() => void refetch()}>
              Try again
            </Button>
          }
        >
          {error instanceof Error ? error.message : 'The Hub did not answer.'}
        </Alert>
      </Container>
    )
  }
  return <BoardView key={id} board={data.board} preset={false} />
}

/** A Board by id: a Preset or a stored Board, migrated on read. */
export function BoardPage() {
  const { boardId } = useParams({ from: '/boards/$boardId' })
  return isPresetId(boardId) ? <PresetBoard id={boardId} /> : <StoredBoard id={boardId} />
}
