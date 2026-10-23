import { GridLayout } from '@mitcsutt/kiln-dnd'
import { Card, Heading, Text } from '@mitcsutt/kiln-ui'

import type { Inventory } from '#features/filters/data/inventory'
import type { BoardFilters, FilterOverride } from '#features/filters/types/filters'
import { useQueryContext } from '#features/filters/hooks/useQueryContext'
import { Widget } from '#features/widgets/components/Widget'
import { getWidget } from '#features/widgets/constants/catalogue'
import type { WidgetDefinition } from '#features/widgets/types/widget'
import { ItemChrome } from '#features/boards/components/ItemChrome'
import { PinFilters } from '#features/boards/components/PinFilters'
import type { BoardDocument, BoardItem, BoardLayoutItem } from '#features/boards/types/board'
import { pinnedFilters } from '#features/boards/utils/editBoard'

/** What edit mode adds to the grid: handles, Remove and pinned filters on each item. */
export interface BoardGridEdit {
  /** Called once per drop that moved or resized something, with the whole Layout. */
  onLayoutChange: (layout: BoardLayoutItem[]) => void
  onRemove: (id: string) => void
  onOverrideChange: (id: string, override: FilterOverride | undefined) => void
  /** The pickers of a pinned filter are filled from it. */
  inventory: Inventory | undefined
  /** Each movable item's handle by item id, kept so the editor can move focus to one. */
  handles: Map<string, HTMLButtonElement>
}

export interface BoardGridProps {
  board: BoardDocument
  /** The filters in force: the URL's over the Board's saved ones. */
  filters: BoardFilters
  now: Date
  tz: string
  /** Set in edit mode; without it the grid is view-only: nothing can be picked up. */
  edit?: BoardGridEdit
}

/** A frame for an item that cannot be drawn, so one bad item never takes the Board down. */
function Unavailable({ title, children }: { title: string; children: string }) {
  return (
    <Card variant="outline" role="group" aria-label={title}>
      <Card.Header>
        <Card.Title level={3}>{title}</Card.Title>
      </Card.Header>
      <Card.Body>
        <Text tone="muted">{children}</Text>
      </Card.Body>
    </Card>
  )
}

function CatalogueWidget({
  id,
  override,
  filters,
  now,
  tz,
}: { id: string; override: FilterOverride | undefined } & Pick<
  BoardGridProps,
  'filters' | 'now' | 'tz'
>) {
  const definition = getWidget(id)
  if (definition === undefined) {
    return (
      <Unavailable title="Unknown Widget">
        {`This Board holds the Widget "${id}", which this Dashboard's Catalogue does not have.`}
      </Unavailable>
    )
  }
  return (
    <KnownWidget definition={definition} override={override} filters={filters} now={now} tz={tz} />
  )
}

function KnownWidget({
  definition,
  override,
  filters,
  now,
  tz,
}: { definition: WidgetDefinition; override: FilterOverride | undefined } & Pick<
  BoardGridProps,
  'filters' | 'now' | 'tz'
>) {
  const ctx = useQueryContext(filters, override, definition, now, tz)
  return <Widget definition={definition} ctx={ctx} pinned={pinnedFilters(override)} />
}

function BoardItemView({
  item,
  filters,
  now,
  tz,
}: { item: BoardItem } & Pick<BoardGridProps, 'filters' | 'now' | 'tz'>) {
  switch (item.type) {
    case 'section':
      return (
        <Heading level={2} size="xl">
          {item.title}
        </Heading>
      )
    case 'widget':
      return (
        <CatalogueWidget
          id={item.widget}
          override={item.override}
          filters={filters}
          now={now}
          tz={tz}
        />
      )
    case 'query':
      return (
        <Unavailable title={item.title}>
          Query Widgets cannot be shown by this Dashboard yet.
        </Unavailable>
      )
  }
}

const itemLabel = (item: BoardItem): string =>
  item.type === 'widget' ? (getWidget(item.widget)?.title ?? 'Unknown Widget') : item.title

/**
 * A Board's items on its 12-column Layout. In view mode there is no `DragHandle` and no resize
 * grip, so nothing moves. In edit mode (`edit` set) each item gets a handle, Remove and, for a
 * Widget, its pinned filters; a move or resize reports the whole Layout. Breakpoints are the grid's own
 * width, not the window's, and the sidebar takes some: 12 columns from `md` (48em) keeps the Layout
 * editable on a laptop. Narrower grids get 8 and 4 columns generated from the stored Layout, so the
 * grid reflows on a phone; there the Layout cannot be rearranged.
 */
export function BoardGrid({ board, filters, now, tz, edit }: BoardGridProps) {
  return (
    <GridLayout
      label={board.name}
      layout={board.layout}
      onChange={
        edit === undefined
          ? undefined
          : (layout) => {
              edit.onLayoutChange(layout)
            }
      }
      columns={{ base: 4, sm: 8, md: 12 }}
    >
      {board.items.map((item) => {
        const content = <BoardItemView item={item} filters={filters} now={now} tz={tz} />
        return (
          <GridLayout.Item
            key={item.i}
            id={item.i}
            label={itemLabel(item)}
            resizable={edit !== undefined && item.type !== 'section'}
          >
            {edit === undefined ? (
              content
            ) : (
              <ItemChrome
                label={itemLabel(item)}
                movable={item.type !== 'section'}
                handleRef={(element) => {
                  if (element === null) edit.handles.delete(item.i)
                  else edit.handles.set(item.i, element)
                }}
                onRemove={() => {
                  edit.onRemove(item.i)
                }}
                actions={
                  item.type === 'section' ? undefined : (
                    <PinFilters
                      title={itemLabel(item)}
                      override={item.override}
                      inventory={edit.inventory}
                      onChange={(override) => {
                        edit.onOverrideChange(item.i, override)
                      }}
                    />
                  )
                }
              >
                {content}
              </ItemChrome>
            )}
          </GridLayout.Item>
        )
      })}
    </GridLayout>
  )
}
