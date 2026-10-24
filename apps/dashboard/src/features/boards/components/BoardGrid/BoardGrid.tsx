import { GridLayout } from '@mitcsutt/kiln-dnd'
import { Card, Heading, Text } from '@mitcsutt/kiln-ui'
import { useMemo, useRef } from 'react'

import type { Inventory } from '#features/filters/data/inventory'
import type { BoardFilters, FilterOverride } from '#features/filters/types/filters'
import { useQueryContext } from '#features/filters/hooks/useQueryContext'
import { QueryWidget } from '#features/widgets/components/QueryWidget'
import { Widget } from '#features/widgets/components/Widget'
import { getWidget } from '#features/widgets/constants/catalogue'
import type { WidgetDefinition } from '#features/widgets/types/widget'
import { ItemChrome } from '#features/boards/components/ItemChrome'
import { PinFilters } from '#features/boards/components/PinFilters'
import { useGridColumns } from '#features/boards/hooks/useGridColumns'
import type { BoardDocument, BoardItem, BoardLayoutItem } from '#features/boards/types/board'
import { pinnedFilters } from '#features/boards/utils/editBoard'
import { reflowLayout } from '#features/boards/utils/reflow'

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

/** A Widget's title is an h2 on a Board without section headings, so headings never skip a level. */
type HeadingLevel = 2 | 3

/** A frame for an item that cannot be drawn, so one bad item never takes the Board down. */
function Unavailable({
  title,
  level,
  children,
}: {
  title: string
  level: HeadingLevel
  children: string
}) {
  return (
    <Card variant="outline" role="group" aria-label={title}>
      <Card.Header>
        <Card.Title level={level}>{title}</Card.Title>
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
  level,
}: { id: string; override: FilterOverride | undefined; level: HeadingLevel } & Pick<
  BoardGridProps,
  'filters' | 'now' | 'tz'
>) {
  const definition = getWidget(id)
  if (definition === undefined) {
    return (
      <Unavailable title="Unknown Widget" level={level}>
        {`This Board holds the Widget "${id}", which this Dashboard's Catalogue does not have.`}
      </Unavailable>
    )
  }
  return (
    <KnownWidget
      definition={definition}
      override={override}
      filters={filters}
      now={now}
      tz={tz}
      level={level}
    />
  )
}

function KnownWidget({
  definition,
  override,
  filters,
  now,
  tz,
  level,
}: {
  definition: WidgetDefinition
  override: FilterOverride | undefined
  level: HeadingLevel
} & Pick<BoardGridProps, 'filters' | 'now' | 'tz'>) {
  const ctx = useQueryContext(filters, override, definition, now, tz)
  return <Widget definition={definition} ctx={ctx} pinned={pinnedFilters(override)} level={level} />
}

function BoardItemView({
  item,
  filters,
  now,
  tz,
  level,
}: { item: BoardItem; level: HeadingLevel } & Pick<BoardGridProps, 'filters' | 'now' | 'tz'>) {
  switch (item.type) {
    case 'section':
      // A section's row is short, so the heading sits on the Widgets below it, not above a gap.
      return (
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <Heading level={2} size="lg">
            {item.title}
          </Heading>
        </div>
      )
    case 'widget':
      return (
        <CatalogueWidget
          id={item.widget}
          override={item.override}
          filters={filters}
          now={now}
          tz={tz}
          level={level}
        />
      )
    case 'query':
      return (
        <QueryWidget
          title={item.title}
          config={item.query}
          override={item.override}
          filters={filters}
          now={now}
          tz={tz}
          level={level}
        />
      )
  }
}

const itemLabel = (item: BoardItem): string =>
  item.type === 'widget' ? (getWidget(item.widget)?.title ?? 'Unknown Widget') : item.title

/**
 * A Board's items on its 12-column Layout of 3rem rows: fine enough that a stat is two rows and a
 * section one, so nothing is taller than what it holds. In view mode there is no `DragHandle` and no resize
 * grip, so nothing moves. In edit mode (`edit` set) each item gets a handle, Remove and, for a
 * Widget, its pinned filters; a move or resize reports the whole Layout. Breakpoints are the grid's own
 * width, not the window's, and the sidebar takes some: 12 columns from `md` (48em) keeps the Layout
 * editable on a laptop. Narrower grids get 8 and 4 columns, reflowed from the stored Layout in view
 * mode and generated by kiln-dnd in edit mode, so the grid reflows on a phone; there the Layout
 * cannot be rearranged.
 */
export function BoardGrid({ board, filters, now, tz, edit }: BoardGridProps) {
  const frame = useRef<HTMLDivElement>(null)
  const columns = useGridColumns(frame)
  // In view mode a narrower grid gets a Layout reflowed in reading order (`reflowLayout`); edit
  // mode keeps kiln-dnd's own, which is read-only below 12 columns anyway.
  const narrow = edit === undefined && columns < 12
  const layout = useMemo(
    () => (narrow ? reflowLayout(board.layout, columns) : board.layout),
    [narrow, board.layout, columns],
  )
  const level: HeadingLevel = board.items.some((item) => item.type === 'section') ? 3 : 2
  return (
    <div ref={frame}>
      <GridLayout
        label={board.name}
        layout={layout}
        onChange={
          edit === undefined
            ? undefined
            : (layout) => {
                edit.onLayoutChange(layout)
              }
        }
        columns={narrow ? columns : { base: 4, sm: 8, md: 12 }}
        rowHeight={7}
        gap={3}
      >
        {board.items.map((item) => {
          const content = (
            <BoardItemView item={item} filters={filters} now={now} tz={tz} level={level} />
          )
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
    </div>
  )
}
