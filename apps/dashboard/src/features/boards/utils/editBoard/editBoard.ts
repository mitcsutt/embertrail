import { appendItem, removeItem } from '@mitcsutt/kiln-dnd'

import type { BoardDocument, BoardItem, BoardLayoutItem } from '#features/boards/types/board'
import type { BoardFilters, FilterOverride } from '#features/filters/types/filters'

const columns = 12
const itemIdLength = 64

/** What adding a Widget needs to know about it; `WidgetDefinition` satisfies it. */
export interface AddableWidget {
  id: string
  size: { w: number; h: number }
}

const slug = (title: string): string =>
  title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')

/** `base`, or `base-2`, `base-3`... the first not already an item id on the Board. */
export function uniqueItemId(board: BoardDocument, base: string): string {
  const taken = new Set(board.items.map((item) => item.i))
  const stem = base.slice(0, itemIdLength - 6)
  let id = stem
  for (let n = 2; taken.has(id); n += 1) id = `${stem}-${String(n)}`
  return id
}

/** The cells as the Board stores them: kiln-dnd may carry fields of its own that a Board refuses. */
function stored(layout: readonly BoardLayoutItem[]): BoardLayoutItem[] {
  return layout.map(({ i, x, y, w, h, static: fixed }) => ({
    i,
    x,
    y,
    w,
    h,
    ...(fixed === true ? { static: true } : {}),
  }))
}

/** The Board with a Layout from the grid, after a move or a resize. */
export function withLayout(
  board: BoardDocument,
  layout: readonly BoardLayoutItem[],
): BoardDocument {
  return { ...board, layout: stored(layout) }
}

/** Appends a Widget of the Catalogue at its default size, below everything else. */
export function addWidgetItem(
  board: BoardDocument,
  widget: AddableWidget,
): { board: BoardDocument; id: string } {
  const id = uniqueItemId(board, widget.id)
  const item: BoardItem = { i: id, type: 'widget', widget: widget.id }
  return {
    id,
    board: {
      ...board,
      items: [...board.items, item],
      layout: stored(
        appendItem(board.layout, { i: id, w: widget.size.w, h: widget.size.h }, { columns }),
      ),
    },
  }
}

/** Appends a full-width heading, static in the Layout like the Presets' own. */
export function addSectionItem(
  board: BoardDocument,
  title: string,
): { board: BoardDocument; id: string } {
  const id = uniqueItemId(board, `section-${slug(title) || 'section'}`)
  const item: BoardItem = { i: id, type: 'section', title }
  return {
    id,
    board: {
      ...board,
      items: [...board.items, item],
      layout: stored(
        appendItem(board.layout, { i: id, w: columns, h: 1, static: true }, { columns }),
      ),
    },
  }
}

/** Takes an item off the Board and closes the gap it leaves. */
export function removeBoardItem(board: BoardDocument, id: string): BoardDocument {
  return {
    ...board,
    items: board.items.filter((item) => item.i !== id),
    layout: stored(removeItem(board.layout, id, { columns })),
  }
}

/** The override without its unset fields; `undefined` when nothing is pinned. */
function pinned(override: FilterOverride | undefined): FilterOverride | undefined {
  if (override === undefined) return undefined
  const kept: FilterOverride = {}
  if (override.time !== undefined) kept.time = override.time
  if (override.sourceId !== undefined) kept.sourceId = override.sourceId
  if (override.accountId !== undefined) kept.accountId = override.accountId
  if (override.model !== undefined) kept.model = override.model
  return Object.keys(kept).length === 0 ? undefined : kept
}

/** The filters an override pins, as words for a badge ("time, model"); `undefined` when none. */
export function pinnedFilters(override: FilterOverride | undefined): string | undefined {
  const kept = pinned(override)
  if (kept === undefined) return undefined
  return [
    kept.time === undefined ? undefined : 'time',
    kept.sourceId === undefined ? undefined : 'Source',
    kept.accountId === undefined ? undefined : 'Account',
    kept.model === undefined ? undefined : 'model',
  ]
    .filter((name) => name !== undefined)
    .join(', ')
}

/** Pins filters on one Widget; an override with nothing pinned unpins it. */
export function setItemOverride(
  board: BoardDocument,
  id: string,
  override: FilterOverride | undefined,
): BoardDocument {
  const kept = pinned(override)
  return {
    ...board,
    items: board.items.map((item) => {
      if (item.i !== id || item.type === 'section') return item
      const rest = { ...item }
      delete rest.override
      return kept === undefined ? rest : { ...rest, override: kept }
    }),
  }
}

/** The Board's saved filters, replaced: what a bare URL shows from now on. */
export function withFilters(board: BoardDocument, filters: BoardFilters): BoardDocument {
  return { ...board, filters }
}

/** Whether two drafts are the same Board, for "unsaved changes". */
export const sameBoard = (a: BoardDocument, b: BoardDocument): boolean =>
  JSON.stringify(a) === JSON.stringify(b)
