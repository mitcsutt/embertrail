import { isProblemError, items } from '@mitcsutt/embertrail-client'
import type { EmbertrailClient, Schemas } from '@mitcsutt/embertrail-client'

import type { BoardDocument } from '#features/boards/types/board'
import { boardNamespace } from '#features/boards/types/board'
import { migrateBoard } from '#features/boards/utils/migrate'

const preconditionFailed = 'urn:embertrail:problem:precondition-failed'
const conflict = 'urn:embertrail:problem:conflict'

/** A Board as read from the `store`: the document, its id and the version to write against. */
export interface StoredBoard {
  id: string
  board: BoardDocument
  /** Send as `If-Match` to replace or delete exactly this version. */
  etag: string
  owner: Schemas['StoreDocument']['owner']
  updatedAt: string
}

export interface BoardSummary {
  id: string
  name: string
  owner: Schemas['StoreDocument']['owner']
  updatedAt: string
}

/**
 * A write lost to another change: the stored Board is no longer the version it was based on.
 * `current` is the server's copy, or `undefined` when the Board has been deleted since.
 */
export class BoardConflict extends Error {
  readonly id: string
  readonly current: StoredBoard | undefined

  constructor(id: string, current: StoredBoard | undefined) {
    super(
      current === undefined
        ? `Board ${id} was deleted elsewhere`
        : `Board ${id} changed elsewhere (version ${current.etag})`,
    )
    this.name = 'BoardConflict'
    this.id = id
    this.current = current
  }
}

const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz'

/** `b-` and ten base36 characters: a valid store id, and never a Preset id. */
export function newBoardId(random: (n: number) => Uint8Array = randomBytes): string {
  let id = 'b-'
  for (const byte of random(10)) id += alphabet.charAt(byte % alphabet.length)
  return id
}

function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n))
}

function stored(document: Schemas['StoreDocument'], etag: string): StoredBoard {
  return {
    id: document.id,
    board: migrateBoard(document.data),
    etag,
    owner: document.owner,
    updatedAt: document.updated_at,
  }
}

/** The `ETag` the Hub sent with a version of a document; the Hub always sends one. */
function etagOf(headers: { ETag?: string | null }): string {
  if (headers.ETag === undefined || headers.ETag === null) throw new Error('The Hub sent no ETag')
  return headers.ETag
}

/** The Boards the caller can read, most recently updated first. Unreadable documents are listed apart. */
export async function listBoards(
  hub: EmbertrailClient,
  signal?: AbortSignal,
): Promise<{ boards: BoardSummary[]; unreadable: string[] }> {
  const boards: BoardSummary[] = []
  const unreadable: string[] = []
  const query = { path: { namespace: boardNamespace } }
  for await (const document of items((cursor) =>
    hub.listStoreDocuments({ ...query, query: { cursor }, signal }),
  )) {
    try {
      boards.push({
        id: document.id,
        name: migrateBoard(document.data).name,
        owner: document.owner,
        updatedAt: document.updated_at,
      })
    } catch {
      unreadable.push(document.id)
    }
  }
  return { boards, unreadable }
}

/** One Board, migrated to the current version. Throws `InvalidBoardError` when it cannot be read. */
export async function getBoard(
  hub: EmbertrailClient,
  id: string,
  signal?: AbortSignal,
): Promise<StoredBoard> {
  const { data, headers } = await hub.getStoreDocument({
    path: { namespace: boardNamespace, id },
    signal,
  })
  return stored(data, etagOf(headers))
}

/**
 * Creates a Board under a fresh id and fails rather than overwrite one. `If-None-Match: *` makes a
 * taken id a 412 or a 409; a new id is tried a few times before giving up.
 */
export async function createBoard(
  hub: EmbertrailClient,
  board: BoardDocument,
  options: { newId?: () => string } = {},
): Promise<StoredBoard> {
  const newId = options.newId ?? newBoardId
  for (let attempt = 0; ; attempt += 1) {
    const id = newId()
    try {
      const { data, headers } = await hub.putStoreDocument({
        path: { namespace: boardNamespace, id },
        header: { 'If-None-Match': '*' },
        body: { data: board },
      })
      return stored(data, etagOf(headers))
    } catch (error) {
      const taken = isProblemError(error, preconditionFailed) || isProblemError(error, conflict)
      if (!taken || attempt >= 2) throw error
    }
  }
}

/**
 * Replaces a Board that is still at `etag`. When it is not, throws `BoardConflict` carrying the
 * server's current copy, and the stored Board is left as it is.
 */
export async function saveBoard(
  hub: EmbertrailClient,
  id: string,
  board: BoardDocument,
  etag: string,
): Promise<StoredBoard> {
  try {
    const { data, headers } = await hub.putStoreDocument({
      path: { namespace: boardNamespace, id },
      header: { 'If-Match': etag },
      body: { data: board },
    })
    return stored(data, etagOf(headers))
  } catch (error) {
    throw await asConflict(hub, id, error)
  }
}

/** Deletes a Board that is still at `etag`; otherwise throws `BoardConflict`. */
export async function deleteBoard(hub: EmbertrailClient, id: string, etag: string): Promise<void> {
  try {
    await hub.deleteStoreDocument({
      path: { namespace: boardNamespace, id },
      header: { 'If-Match': etag },
    })
  } catch (error) {
    throw await asConflict(hub, id, error)
  }
}

async function asConflict(hub: EmbertrailClient, id: string, error: unknown): Promise<unknown> {
  if (!isProblemError(error, preconditionFailed)) return error
  try {
    return new BoardConflict(id, await getBoard(hub, id))
  } catch (reading) {
    // A 404 is the conflict "deleted since"; anything else is the read's own failure.
    return isProblemError(reading, 'urn:embertrail:problem:not-found')
      ? new BoardConflict(id, undefined)
      : reading
  }
}
