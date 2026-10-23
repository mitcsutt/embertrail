// @vitest-environment node

import { createClient, isProblemError } from '@mitcsutt/embertrail-client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { dashboardTestHub } from '#test/hub'
import type { DashboardTestHub } from '#test/hub'

import { boardNamespace } from '#features/boards/types/board'
import type { BoardDocument } from '#features/boards/types/board'
import { InvalidBoardError, UnsupportedBoardVersionError } from '#features/boards/utils/migrate'
import { customisePreset, overviewPreset } from '#features/boards/utils/presets'

import {
  BoardConflict,
  createBoard,
  deleteBoard,
  getBoard,
  listBoards,
  newBoardId,
  saveBoard,
  teamOf,
} from './boards'

let hub: DashboardTestHub
beforeAll(async () => {
  hub = await dashboardTestHub({ demo: false })
})
afterAll(async () => {
  await hub.close()
})

/** A second client for the same User, as a second browser tab would be. */
async function otherClient() {
  const { token } = await hub.t.hub.directory.issueToken('dashboard', {
    kind: 'management',
    scopes: ['store:read', 'store:write'],
  })
  return createClient({
    baseUrl: 'http://hub.test',
    token,
    fetch: (input, init) => hub.t.hub.fetch(new Request(input, init)),
  })
}

const named = (name: string): BoardDocument => ({ ...structuredClone(overviewPreset), name })

describe('newBoardId', () => {
  it('is b- and ten base36 characters, which the store takes and no Preset uses', () => {
    for (let n = 0; n < 50; n += 1) expect(newBoardId()).toMatch(/^b-[a-z0-9]{10}$/)
    expect(newBoardId(() => new Uint8Array(10))).toBe('b-0000000000')
  })
})

describe('Boards in the store', () => {
  it('creates a Board and reads it back with its version', async () => {
    const created = await createBoard(hub.client, named('First'))
    expect(created.id).toMatch(/^b-/)
    expect(created.etag).not.toBe('')
    const read = await getBoard(hub.client, created.id)
    expect(read.board).toEqual(named('First'))
    expect(read.etag).toBe(created.etag)
    expect(read.owner.kind).toBe('user')
  })

  it('saves on the version it read and moves to the next', async () => {
    const created = await createBoard(hub.client, named('Saved'))
    const saved = await saveBoard(hub.client, created.id, named('Saved again'), created.etag)
    expect(saved.etag).not.toBe(created.etag)
    expect((await getBoard(hub.client, created.id)).board.name).toBe('Saved again')
  })

  it('tries another id when one is taken, and gives up after three', async () => {
    const taken = await createBoard(hub.client, named('Taken'))
    const ids = [taken.id, taken.id, 'b-freeid0001']
    const next = () => ids.shift() ?? 'b-nomoreids1'
    const created = await createBoard(hub.client, named('Retried'), { newId: next })
    expect(created.id).toBe('b-freeid0001')
    await expect(
      createBoard(hub.client, named('Never'), { newId: () => taken.id }),
    ).rejects.toSatisfy((error: unknown) =>
      isProblemError(error, 'urn:embertrail:problem:precondition-failed'),
    )
    expect((await getBoard(hub.client, taken.id)).board.name).toBe('Taken')
  })

  it('lists the Boards, most recently updated first, and sets unreadable documents apart', async () => {
    const mine = await createBoard(hub.client, named('Listed'))
    for (const [id, data] of [
      ['b-notaboard1', { name: 'no version' }],
      ['b-newerboard1', { schema_version: 9 }],
    ] as const) {
      await hub.client.putStoreDocument({
        path: { namespace: boardNamespace, id },
        header: { 'If-None-Match': '*' },
        body: { data },
      })
    }
    const { boards, unreadable } = await listBoards(hub.client)
    expect(boards.find((board) => board.id === mine.id)).toMatchObject({ name: 'Listed' })
    expect(unreadable.toSorted()).toEqual(['b-newerboard1', 'b-notaboard1'])
    expect(boards.map((board) => board.id)).not.toContain('b-notaboard1')
  })

  it('refuses to read a stored document that is not a Board', async () => {
    await expect(getBoard(hub.client, 'b-notaboard1')).rejects.toBeInstanceOf(InvalidBoardError)
    await expect(getBoard(hub.client, 'b-newerboard1')).rejects.toBeInstanceOf(
      UnsupportedBoardVersionError,
    )
  })

  it('deletes a Board at its version', async () => {
    const created = await createBoard(hub.client, named('Doomed'))
    await deleteBoard(hub.client, created.id, created.etag)
    await expect(getBoard(hub.client, created.id)).rejects.toSatisfy((error: unknown) =>
      isProblemError(error, 'urn:embertrail:problem:not-found'),
    )
  })
})

describe('Customising a Preset', () => {
  it('creates a new store document and leaves the Preset as it was', async () => {
    const before = structuredClone(overviewPreset)
    const created = await createBoard(hub.client, customisePreset(overviewPreset))
    expect(created.board.name).toBe('Overview (copy)')
    expect(created.board.items).toEqual(before.items)
    expect(overviewPreset).toEqual(before)
    await saveBoard(hub.client, created.id, { ...created.board, name: 'Mine' }, created.etag)
    expect(overviewPreset).toEqual(before)
    expect((await getBoard(hub.client, created.id)).board.name).toBe('Mine')
  })
})

describe('Two clients saving the same Board', () => {
  it('gives the loser a BoardConflict with the winner’s copy, and overwrites nothing', async () => {
    const other = await otherClient()
    const created = await createBoard(hub.client, named('Race'))
    const winner = await saveBoard(other, created.id, named('Winner'), created.etag)

    const loss = await saveBoard(hub.client, created.id, named('Loser'), created.etag).catch(
      (error: unknown) => error,
    )
    expect(loss).toBeInstanceOf(BoardConflict)
    const conflict = loss as BoardConflict
    expect(conflict.id).toBe(created.id)
    expect(conflict.current?.board.name).toBe('Winner')
    expect(conflict.current?.etag).toBe(winner.etag)
    expect((await getBoard(hub.client, created.id)).board.name).toBe('Winner')

    // Reloading and saving on the new version goes through.
    const retried = await saveBoard(hub.client, created.id, named('Merged'), winner.etag)
    expect(retried.board.name).toBe('Merged')
  })

  it('reports a Board deleted meanwhile as a conflict with no current copy', async () => {
    const other = await otherClient()
    const created = await createBoard(hub.client, named('Gone'))
    await deleteBoard(other, created.id, created.etag)
    const loss = await saveBoard(hub.client, created.id, named('Late'), created.etag).catch(
      (error: unknown) => error,
    )
    expect(loss).toBeInstanceOf(BoardConflict)
    expect((loss as BoardConflict).current).toBeUndefined()
  })

  it('makes a stale delete a BoardConflict too, keeping the Board', async () => {
    const other = await otherClient()
    const created = await createBoard(hub.client, named('Kept'))
    await saveBoard(other, created.id, named('Kept, edited'), created.etag)
    await expect(deleteBoard(hub.client, created.id, created.etag)).rejects.toBeInstanceOf(
      BoardConflict,
    )
    expect((await getBoard(hub.client, created.id)).board.name).toBe('Kept, edited')
  })

  it('makes a delete of an already deleted Board a conflict with no current copy', async () => {
    const other = await otherClient()
    const created = await createBoard(hub.client, named('Twice'))
    await deleteBoard(other, created.id, created.etag)
    const loss = await deleteBoard(hub.client, created.id, created.etag).catch(
      (error: unknown) => error,
    )
    expect(loss).toBeInstanceOf(BoardConflict)
    expect((loss as BoardConflict).current).toBeUndefined()
  })

  it('still reports a conflict when the winner’s copy cannot be read', async () => {
    const created = await createBoard(hub.client, named('Newer'))
    await hub.client.putStoreDocument({
      path: { namespace: boardNamespace, id: created.id },
      header: { 'If-Match': created.etag },
      body: { data: { ...created.board, schema_version: 2 } },
    })
    const loss = await saveBoard(hub.client, created.id, named('Late'), created.etag).catch(
      (error: unknown) => error,
    )
    expect(loss).toBeInstanceOf(BoardConflict)
    expect((loss as BoardConflict).cause).toBeInstanceOf(UnsupportedBoardVersionError)
  })
})

describe('Writing an invalid Board', () => {
  const orphanCell = (): BoardDocument => {
    const board = named('Orphan')
    return { ...board, items: board.items.slice(1) }
  }

  it('is refused before it is stored', async () => {
    await expect(createBoard(hub.client, orphanCell())).rejects.toBeInstanceOf(InvalidBoardError)
    const created = await createBoard(hub.client, named('Fine'))
    await expect(
      saveBoard(hub.client, created.id, orphanCell(), created.etag),
    ).rejects.toBeInstanceOf(InvalidBoardError)
    expect((await getBoard(hub.client, created.id)).board.name).toBe('Fine')
  })
})

describe('Team Boards', () => {
  /** A client for a User with their own management Token, as that User's Dashboard would hold. */
  async function clientFor(userId: string) {
    await hub.t.user(userId)
    const { token } = await hub.t.hub.directory.issueToken(userId, {
      kind: 'management',
      scopes: ['store:read', 'store:write'],
    })
    return createClient({
      baseUrl: 'http://hub.test',
      token,
      fetch: (input, init) => hub.t.hub.fetch(new Request(input, init)),
    })
  }

  it('is created by a Team editor, listed for a second member, and left to the editors to write', async () => {
    const editor = await clientFor('tb-editor')
    const member = await clientFor('tb-member')
    const outsider = await clientFor('tb-outsider')
    await hub.t.team('tb-crew', { editors: ['tb-editor'], members: ['tb-member'] })

    const created = await createBoard(editor, named('Crew spend'), { team: 'tb-crew' })
    expect(created.owner).toEqual({ kind: 'team', id: 'tb-crew' })
    expect(teamOf(created.owner)).toBe('tb-crew')

    // The second member reads it, in the list and by id; the outsider does not.
    const listed = await listBoards(member)
    expect(listed.boards.find(({ id }) => id === created.id)).toMatchObject({
      name: 'Crew spend',
      owner: { kind: 'team', id: 'tb-crew' },
    })
    expect((await getBoard(member, created.id)).board.name).toBe('Crew spend')
    expect((await listBoards(outsider)).boards.map(({ id }) => id)).not.toContain(created.id)

    // The member cannot replace or delete it, with or without acting for the Team.
    const refused = (error: unknown) => isProblemError(error) && error.status >= 400
    for (const options of [{}, { team: 'tb-crew' }]) {
      await expect(
        saveBoard(member, created.id, named('Taken over'), created.etag, options),
      ).rejects.toSatisfy(refused)
      await expect(deleteBoard(member, created.id, created.etag, options)).rejects.toSatisfy(
        refused,
      )
    }
    expect((await getBoard(editor, created.id)).board.name).toBe('Crew spend')

    // The editor writes it only as the Team.
    const saved = await saveBoard(editor, created.id, named('Crew spend 2'), created.etag, {
      team: 'tb-crew',
    })
    expect(saved.owner).toEqual({ kind: 'team', id: 'tb-crew' })
    await deleteBoard(editor, created.id, saved.etag, { team: 'tb-crew' })
    await expect(getBoard(editor, created.id)).rejects.toSatisfy((error: unknown) =>
      isProblemError(error, 'urn:embertrail:problem:not-found'),
    )
  })

  it('refuses a Board for a Team the caller does not edit', async () => {
    const member = await clientFor('tb-reader')
    await hub.t.team('tb-other', { members: ['tb-reader'] })
    await expect(createBoard(member, named('Nope'), { team: 'tb-other' })).rejects.toSatisfy(
      (error: unknown) => isProblemError(error) && error.status === 403,
    )
  })
})

const ownerHeader = 'Embertrail-Owner'

interface Recorded {
  method: string
  owner: string | null
}

/** A client for a User, recording the method and `Embertrail-Owner` of each request it makes. */
async function recordingClientFor(userId: string) {
  await hub.t.user(userId)
  const { token } = await hub.t.hub.directory.issueToken(userId, {
    kind: 'management',
    scopes: ['store:read', 'store:write'],
  })
  const requests: Recorded[] = []
  const client = createClient({
    baseUrl: 'http://hub.test',
    token,
    fetch: (input, init) => {
      const request = new Request(input, init)
      requests.push({ method: request.method, owner: request.headers.get(ownerHeader) })
      return hub.t.hub.fetch(request)
    },
  })
  return { client, requests }
}

describe('Embertrail-Owner on Team Board requests', () => {
  it('goes on a Team editor’s writes and on no read, and the Hub refuses a non-editor member', async () => {
    const editor = await recordingClientFor('oh-editor')
    const member = await recordingClientFor('oh-member')
    await hub.t.team('oh-crew', { editors: ['oh-editor'], members: ['oh-member'] })
    const team = 'oh-crew'

    const created = await createBoard(editor.client, named('Crew'), { team })
    const saved = await saveBoard(editor.client, created.id, named('Crew 2'), created.etag, {
      team,
    })
    await getBoard(editor.client, created.id)
    await listBoards(editor.client)
    await deleteBoard(editor.client, created.id, saved.etag, { team })

    const writes = editor.requests.filter(({ method }) => method !== 'GET')
    expect(writes.map(({ method }) => method)).toEqual(['PUT', 'PUT', 'DELETE'])
    expect(writes.map(({ owner }) => owner)).toEqual(Array(3).fill(`team:${team}`))
    const reads = editor.requests.filter(({ method }) => method === 'GET')
    expect(reads.length).toBeGreaterThan(0)
    expect(reads.map(({ owner }) => owner)).toEqual(reads.map(() => null))

    // A member who is not an editor reads it without the header, and the Hub refuses their write.
    const other = await createBoard(editor.client, named('Crew other'), { team })
    member.requests.length = 0
    expect((await getBoard(member.client, other.id)).board.name).toBe('Crew other')
    expect((await listBoards(member.client)).boards.map(({ id }) => id)).toContain(other.id)
    expect(member.requests.map(({ owner }) => owner)).toEqual(member.requests.map(() => null))

    const refused = (error: unknown) => isProblemError(error) && error.status >= 400
    await expect(
      saveBoard(member.client, other.id, named('Taken'), other.etag, { team }),
    ).rejects.toSatisfy(refused)
    await expect(deleteBoard(member.client, other.id, other.etag, { team })).rejects.toSatisfy(
      refused,
    )
    expect((await getBoard(editor.client, other.id)).board.name).toBe('Crew other')
  })
})
