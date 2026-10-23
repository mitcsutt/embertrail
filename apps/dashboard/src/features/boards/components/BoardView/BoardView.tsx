import { Button, Container, EmptyState, Heading, Inline, Stack } from '@mitcsutt/kiln-ui'
import { useState } from 'react'

import { BoardGrid } from '#features/boards/components/BoardGrid'
import type { BoardDocument } from '#features/boards/types/board'
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
}

/**
 * One Board in view mode: its name, the filter bar and the grid, with one colour per model across
 * every chart. The filters live in the URL over the Board's saved ones.
 */
export function BoardView({ board, preset }: BoardViewProps) {
  const { client } = useHub()
  const { canEdit } = useSelf()
  const { filters, setFilters, tz } = useBoardFilters(board.filters)
  const [now] = useState(() => new Date())
  const window = useResolvedWindow(filters.time, now, tz)
  const inventory = useInventory(client, window)

  return (
    <Container width="full">
      <Stack gap={4}>
        <Inline justify="between" align="center">
          <Heading level={1} size="2xl">
            {board.name}
          </Heading>
          {canEdit ? (
            // Edit mode arrives with the Board editor (#72 D7), which replaces this.
            <Button variant="outline" disabled>
              {preset ? 'Customise' : 'Edit'}
            </Button>
          ) : null}
        </Inline>
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
            description="Customise it to add Widgets from the Catalogue."
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
