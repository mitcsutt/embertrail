import type { BoardDocument } from '#features/boards/types/board'
import { boardSchema } from '#features/boards/schemas/board'

/** The version `BoardDocument` has today; a stored Board older than this is migrated on read. */
export const currentBoardVersion = 1

/** Lifts a stored Board from one `schema_version` to the next. */
export type BoardMigration = (board: Record<string, unknown>) => Record<string, unknown>

/** Keyed by the version each step reads. Version 1 is the first, so there is nothing to lift yet. */
export const boardMigrations: Readonly<Record<number, BoardMigration>> = {}

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Reads a stored Board of any version into the current `BoardDocument`. Throws
 * `UnsupportedBoardVersionError` for a newer version and `InvalidBoardError` for anything else
 * that does not parse. `migrations` is a parameter so a test can exercise a path v1 does not need.
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
