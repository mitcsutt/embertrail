import type { BoardLayoutItem } from '#features/boards/types/board'
import { layoutColumns } from '#features/boards/schemas/board'

/** What a row is laid out from: an id and a size in columns and rows. */
export interface Sized {
  id: string
  w: number
  h: number
}

/**
 * A row stretched to the full width, so it leaves no hole beside its last cell: each width grows
 * in proportion (the remainder goes to the largest fractions, then to the left), and every cell
 * takes the row's tallest height, so the cards line up.
 */
export function fillRow<T extends Sized>(row: readonly T[], columns: number = layoutColumns): T[] {
  const total = row.reduce((sum, { w }) => sum + w, 0)
  const exact = row.map(({ w }) => (w * columns) / total)
  const widths = exact.map(Math.floor)
  let left = columns - widths.reduce((sum, w) => sum + w, 0)
  for (const index of exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .toSorted((a, b) => b.fraction - a.fraction)
    .map(({ index }) => index)) {
    if (left === 0) break
    widths[index] = (widths[index] ?? 0) + 1
    left -= 1
  }
  const height = Math.max(...row.map(({ h }) => h))
  return row.map((cell, index) => ({ ...cell, w: widths[index] ?? cell.w, h: height }))
}

/** Cells in rows, in order, wrapping before one that would run past `columns`. */
export function intoRows<T extends Sized>(cells: readonly T[], columns: number): T[][] {
  const rows: T[][] = []
  let row: T[] = []
  let width = 0
  for (const cell of cells) {
    if (row.length > 0 && width + cell.w > columns) {
      rows.push(row)
      row = []
      width = 0
    }
    row.push(cell)
    width += cell.w
  }
  if (row.length > 0) rows.push(row)
  return rows
}

/**
 * The stored 12-column Layout for a narrower grid, in reading order: a stat (3 columns or fewer)
 * keeps a share of the width, at least two columns, and on four columns anything wider takes the
 * whole row; then each row is filled to the full width. kiln-dnd's own narrow layouts keep each
 * cell's column where it fits and pile the rest into the last one, which leaves a column empty
 * beside a row of stats.
 */
export function reflowLayout(
  layout: readonly BoardLayoutItem[],
  columns: number,
): BoardLayoutItem[] {
  if (columns >= layoutColumns) return [...layout]
  const ordered = layout
    .map((cell) => ({ ...cell, id: cell.i }))
    .toSorted((a, b) => a.y - b.y || a.x - b.x)
  const narrowed = ordered.map((cell) => {
    const share = Math.round((cell.w * columns) / layoutColumns)
    const w = columns <= 4 && cell.w > 3 ? columns : Math.min(columns, Math.max(2, share))
    return { ...cell, w }
  })
  const placed: BoardLayoutItem[] = []
  let y = 0
  for (const row of intoRows(narrowed, columns)) {
    let x = 0
    const filled = fillRow(row, columns)
    for (const { i, w, h, static: fixed } of filled) {
      placed.push({ i, x, y, w, h, ...(fixed === true ? { static: true } : {}) })
      x += w
    }
    y += filled[0]?.h ?? 0
  }
  return placed
}
