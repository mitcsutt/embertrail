import { compact } from '@mitcsutt/kiln-dnd'

import type { BoardDocument } from '#features/boards/types/board'
import { boardSchema, layoutColumns } from '#features/boards/schemas/board'

/** The version `BoardDocument` has today; a stored Board older than this is migrated on read. */
export const currentBoardVersion = 2

/** Lifts a stored Board from one `schema_version` to the next. */
export type BoardMigration = (board: Record<string, unknown>) => Record<string, unknown>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

interface Cell {
  i: string
  x: number
  y: number
  w: number
  h: number
  [key: string]: unknown
}

const isCell = (value: unknown): value is Cell =>
  isRecord(value) &&
  typeof value.i === 'string' &&
  ['x', 'y', 'w', 'h'].every((key) => Number.isInteger(value[key]))

/**
 * Version 2 halves the grid's row (6rem to 3rem, with a smaller gap), so a stored Board keeps its
 * look: every row and height doubles, except a section, which stays one (now shorter) row, and the
 * Layout is compacted to close the row each section gave back. Anything that is not a Layout cell
 * is left for the schema to refuse.
 */
export function doubleRows(board: Record<string, unknown>): Record<string, unknown> {
  const { items, layout } = board
  if (!Array.isArray(layout) || !layout.every(isCell)) return board
  const sections = new Set(
    (Array.isArray(items) ? items : []).flatMap((item) =>
      isRecord(item) && item.type === 'section' && typeof item.i === 'string' ? [item.i] : [],
    ),
  )
  const doubled = layout.map((cell) => ({
    ...cell,
    y: cell.y * 2,
    h: sections.has(cell.i) ? 1 : cell.h * 2,
  }))
  // Compacted as if nothing were static, so a section moves up with what is above it. Only the
  // rows are taken from the result: kiln-dnd may add fields a Board refuses.
  const loose = doubled.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }))
  const rows = new Map(compact(loose, { columns: layoutColumns }).map(({ i, y }) => [i, y]))
  return { ...board, layout: doubled.map((cell) => ({ ...cell, y: rows.get(cell.i) ?? cell.y })) }
}

/** Keyed by the version each step reads. */
export const boardMigrations: Readonly<Record<number, BoardMigration>> = { 1: doubleRows }

/** The stored document is not a Board, or no migration reaches the current version. */
export class InvalidBoardError extends Error {
  readonly issues: string[]

  constructor(issues: string[]) {
    super(`Not a valid Board: ${issues.join('; ')}`)
    this.name = 'InvalidBoardError'
    this.issues = issues
  }
}

/** The document was written by a newer Dashboard than this one. */
export class UnsupportedBoardVersionError extends Error {
  readonly version: number

  constructor(version: number) {
    super(
      `This Board is version ${String(version)}; this Dashboard reads up to ${String(currentBoardVersion)}`,
    )
    this.name = 'UnsupportedBoardVersionError'
    this.version = version
  }
}

/**
 * Reads a stored Board of any version into the current `BoardDocument`. Throws
 * `UnsupportedBoardVersionError` for a newer version and `InvalidBoardError` for anything else
 * that does not parse. `migrations` is a parameter so a test can exercise a path the real ones do not.
 */
export function migrateBoard(
  stored: unknown,
  migrations: Readonly<Record<number, BoardMigration>> = boardMigrations,
  current: number = currentBoardVersion,
): BoardDocument {
  if (!isRecord(stored)) throw new InvalidBoardError(['a Board is an object'])
  let board = stored
  let version = board.schema_version
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
    throw new InvalidBoardError(['schema_version is not a version number'])
  }
  if (version > current) throw new UnsupportedBoardVersionError(version)
  while (version < current) {
    const step = migrations[version]
    if (step === undefined) {
      throw new InvalidBoardError([`no migration from schema_version ${String(version)}`])
    }
    version += 1
    board = { ...step(board), schema_version: version }
  }
  const parsed = boardSchema.safeParse(board)
  if (!parsed.success) {
    throw new InvalidBoardError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    )
  }
  return parsed.data
}
