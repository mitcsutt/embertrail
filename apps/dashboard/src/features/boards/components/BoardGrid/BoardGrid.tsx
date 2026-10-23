import { GridLayout } from '@mitcsutt/kiln-dnd'
import { Card, Heading, Text } from '@mitcsutt/kiln-ui'

import type { BoardFilters, FilterOverride } from '#features/filters/types/filters'
import { useQueryContext } from '#features/filters/hooks/useQueryContext'
import { Widget } from '#features/widgets/components/Widget'
import { getWidget } from '#features/widgets/constants/catalogue'
import type { WidgetDefinition } from '#features/widgets/types/widget'
import type { BoardDocument, BoardItem } from '#features/boards/types/board'

export interface BoardGridProps {
  board: BoardDocument
  /** The filters in force: the URL's over the Board's saved ones. */
  filters: BoardFilters
  now: Date
  tz: string
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
}: { id: string; override: FilterOverride | undefined } & Omit<BoardGridProps, 'board'>) {
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
}: { definition: WidgetDefinition; override: FilterOverride | undefined } & Omit<
  BoardGridProps,
  'board'
>) {
  const ctx = useQueryContext(filters, override, definition, now, tz)
  return <Widget definition={definition} ctx={ctx} />
}

function BoardItemView({
  item,
  filters,
  now,
  tz,
}: { item: BoardItem } & Omit<BoardGridProps, 'board'>) {
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
 * A Board's items on its 12-column Layout, in view mode: no `DragHandle` and no resize grip, so
 * nothing moves. Narrower widths get a column count of their own (4 and 8) generated from the
 * stored Layout, so the grid reflows on a phone.
 */
export function BoardGrid({ board, filters, now, tz }: BoardGridProps) {
  return (
    <GridLayout label={board.name} layout={board.layout} columns={{ base: 4, md: 8, lg: 12 }}>
      {board.items.map((item) => (
        <GridLayout.Item key={item.i} id={item.i} label={itemLabel(item)} resizable={false}>
          <BoardItemView item={item} filters={filters} now={now} tz={tz} />
        </GridLayout.Item>
      ))}
    </GridLayout>
  )
}
