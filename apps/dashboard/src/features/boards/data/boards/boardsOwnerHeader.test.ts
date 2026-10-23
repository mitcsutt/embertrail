// @vitest-environment node

import { createClient, isProblemError } from '@mitcsutt/embertrail-client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { dashboardTestHub } from '#test/hub'
import type { DashboardTestHub } from '#test/hub'

import type { BoardDocument } from '#features/boards/types/board'
import { overviewPreset } from '#features/boards/utils/presets'

import { createBoard, deleteBoard, getBoard, listBoards, saveBoard } from './boards'

const ownerHeader = 'Embertrail-Owner'

let hub: DashboardTestHub
beforeAll(async () => {
  hub = await dashboardTestHub({ demo: false })
})
afterAll(async () => {
  await hub.close()
})

const named = (name: string): BoardDocument => ({ ...structuredClone(overviewPreset), name })

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
