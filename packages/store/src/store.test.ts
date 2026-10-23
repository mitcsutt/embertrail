import assert from 'node:assert/strict'

import { assertModuleContract, testHub } from '@mitcsutt/embertrail-hub/testing'
import type { TestClient, TestHub } from '@mitcsutt/embertrail-hub/testing'
import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { maxDataBytes, store } from './index'

const scopes = ['store:read', 'store:write'] as const
const doc = '/api/v1/store/notes/first'

interface StoreDocument {
  namespace: string
  id: string
  owner: { kind: string; id: string }
  version: number
  created_at: string
  updated_at: string
  data: unknown
}

interface Page {
  items: StoreDocument[]
  next_cursor: string | null
}

const json = async <T>(response: Response) => (await response.json()) as T

function put(
  client: TestClient,
  path: string,
  data: unknown,
  headers: Record<string, string> = {},
) {
  return client.fetch(path, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ data }),
  })
}

describe('the store Module', () => {
  it('passes the Module contract suite', async () => {
    await assertModuleContract(store, {
      async seed(_, management) {
        expect((await management.put(doc, { data: { a: 1 } })).status).toBe(201)
        expect((await management.put('/api/v1/store/other/second', { data: [1, 2] })).status).toBe(
          201,
        )
      },
    })
  })

  // No raw ops, Scope overrides or exporter: the core derives OpenAPI, Scopes, export and
  // delete from the declaration, and the contract suite above proves the ownership side.
  it('leaves OpenAPI, Scopes and export to the core', () => {
    expect(store.export).toBeUndefined()
    expect(store.retention).toBeUndefined()
    expect(store.scopes).toEqual(['store:read', 'store:write'])
    for (const op of Object.values(store.ops)) {
      expect(op.kind).not.toBe('raw')
      expect(op.scope).toBeUndefined()
    }
  })

  describe('through HTTP', () => {
    let t: TestHub
    let time: Date
    let alice: TestClient

    beforeEach(async () => {
      time = new Date('2026-10-19T09:00:00.000Z')
      t = await testHub({ modules: [store], clock: () => time })
      alice = t.as('alice', scopes)
    })

    afterEach(async () => {
      await t.close()
      assert.deepEqual(t.errors, [], 'the Hub answered with a 500')
    })

    const later = (seconds: number) => {
      time = new Date(time.getTime() + seconds * 1000)
    }

    it('refuses a Token bound to a Source on PUT and DELETE, as a leaked device Token must not edit Boards', async () => {
      expect((await put(alice, doc, { title: 'Board' })).status).toBe(201)
      const device = t.as('alice', scopes, { sourceId: 'laptop' })
      for (const response of [
        await put(device, doc, { title: 'Overwritten' }),
        await device.delete(doc),
      ]) {
        expect(response.status).toBe(403)
        expect(await json(response)).toMatchObject({
          type: 'urn:embertrail:problem:forbidden',
          detail: 'Needs a Token not bound to a Source',
        })
      }
      expect(await json<StoreDocument>(await alice.get(doc))).toMatchObject({
        data: { title: 'Board' },
      })
      expect((await alice.delete(doc)).status).toBe(204)
    })

    it('creates, reads, replaces, lists and deletes a document', async () => {
      const created = await put(alice, doc, { title: 'Groceries' })
      expect(created.status).toBe(201)
      const etag = created.headers.get('etag')
      expect(etag).toMatch(/^"[0-9a-z]+\.1"$/)
      expect(await json(created)).toEqual({
        namespace: 'notes',
        id: 'first',
        owner: { kind: 'user', id: 'alice' },
        version: 1,
        created_at: '2026-10-19T09:00:00.000Z',
        updated_at: '2026-10-19T09:00:00.000Z',
        data: { title: 'Groceries' },
      })

      const read = await alice.get(doc)
      expect(read.status).toBe(200)
      expect(read.headers.get('etag')).toBe(etag)

      later(60)
      const replaced = await put(alice, doc, { title: 'Hardware' })
      expect(replaced.status).toBe(200)
      expect(replaced.headers.get('etag')).not.toBe(etag)
      expect(await json(replaced)).toMatchObject({
        version: 2,
        created_at: '2026-10-19T09:00:00.000Z',
        updated_at: '2026-10-19T09:01:00.000Z',
        data: { title: 'Hardware' },
      })

      const listed = await json<Page>(await alice.get('/api/v1/store/notes'))
      expect(listed.items.map((d) => [d.id, d.version])).toEqual([['first', 2]])
      expect(listed.next_cursor).toBeNull()

      const deleted = await alice.delete(doc)
      expect(deleted.status).toBe(204)
      expect(await deleted.text()).toBe('')
      expect((await alice.get(doc)).status).toBe(404)
      expect((await alice.delete(doc)).status).toBe(404)
    })

    it('stores any JSON value exactly', async () => {
      for (const data of [null, '123', 'text', 0, false, [1, 'a', null], { nested: { n: 1.5 } }]) {
        await put(alice, doc, data)
        expect((await json<StoreDocument>(await alice.get(doc))).data).toEqual(data)
      }
    })

    it('refuses a body without data, or with other keys', async () => {
      expect((await alice.put(doc, {})).status).toBe(400)
      expect((await alice.put(doc, { data: 1, extra: true })).status).toBe(400)
      expect((await alice.put('/api/v1/store/Not_A_Slug/first', { data: 1 })).status).toBe(400)
    })

    describe('conditional requests', () => {
      it('replaces with a matching If-Match, and answers 412 to a stale one', async () => {
        const etag = (await put(alice, doc, 1)).headers.get('etag') ?? ''
        const replaced = await put(alice, doc, 2, { 'if-match': etag })
        expect(replaced.status).toBe(200)

        const stale = await put(alice, doc, 3, { 'if-match': etag })
        expect(stale.status).toBe(412)
        expect(await json(stale)).toMatchObject({
          type: 'urn:embertrail:problem:precondition-failed',
        })
        expect((await json<StoreDocument>(await alice.get(doc))).data).toBe(2)
      })

      it('accepts If-Match lists and *, and never matches a weak tag', async () => {
        const etag = (await put(alice, doc, 1)).headers.get('etag') ?? ''
        expect((await put(alice, doc, 2, { 'if-match': `"nope", ${etag}` })).status).toBe(200)
        expect((await put(alice, doc, 3, { 'if-match': `"nope", ${etag}` })).status).toBe(412)
        expect((await put(alice, doc, 4, { 'if-match': '*' })).status).toBe(200)
        const latest = (await alice.get(doc)).headers.get('etag') ?? ''
        expect((await put(alice, doc, 5, { 'if-match': `W/${latest}` })).status).toBe(412)
      })

      it('answers 412 to If-Match on a document that does not exist', async () => {
        expect((await put(alice, doc, 1, { 'if-match': '*' })).status).toBe(412)
        expect((await alice.get(doc)).status).toBe(404)
      })

      it('answers 412 to If-None-Match: * on an existing id, and creates with it otherwise', async () => {
        expect((await put(alice, doc, 1, { 'if-none-match': '*' })).status).toBe(201)
        const again = await put(alice, doc, 2, { 'if-none-match': '*' })
        expect(again.status).toBe(412)
        expect((await json<StoreDocument>(await alice.get(doc))).data).toBe(1)
      })

      it('does not match an ETag from before the id was deleted and created again', async () => {
        const old = (await put(alice, doc, 1)).headers.get('etag') ?? ''
        await alice.delete(doc)
        later(1)
        expect((await put(alice, doc, 2)).headers.get('etag')).not.toBe(old)
        expect((await put(alice, doc, 3, { 'if-match': old })).status).toBe(412)
      })

      it('honours If-Match on DELETE', async () => {
        const etag = (await put(alice, doc, 1)).headers.get('etag') ?? ''
        await put(alice, doc, 2)
        const stale = await alice.fetch(doc, { method: 'DELETE', headers: { 'if-match': etag } })
        expect(stale.status).toBe(412)
        const current = (await alice.get(doc)).headers.get('etag') ?? ''
        const fresh = await alice.fetch(doc, { method: 'DELETE', headers: { 'if-match': current } })
        expect(fresh.status).toBe(204)
      })
    })

    describe('size limit', () => {
      // A JSON string serialises with two quotes around it.
      const serialisedAs = (bytes: number) => 'a'.repeat(bytes - 2)

      it('accepts a document of exactly 1 MiB serialised', async () => {
        expect((await put(alice, doc, serialisedAs(maxDataBytes))).status).toBe(201)
      })

      it('answers 413 to a document of 1 MiB + 1 byte', async () => {
        const response = await put(alice, doc, serialisedAs(maxDataBytes + 1))
        expect(response.status).toBe(413)
        expect(await json(response)).toMatchObject({
          type: 'urn:embertrail:problem:payload-too-large',
        })
        expect((await alice.get(doc)).status).toBe(404)
      })

      it('counts bytes, not characters', async () => {
        const response = await put(alice, doc, 'é'.repeat(maxDataBytes / 2))
        expect(response.status).toBe(413)
      })
    })

    describe('an id held by a document the caller cannot see', () => {
      beforeEach(async () => {
        assert.equal((await put(t.as('bob', scopes), doc, { secret: 'bob' })).status, 201)
      })

      it('answers 409 conflict and reveals nothing else', async () => {
        const response = await put(alice, doc, { mine: true })
        expect(response.status).toBe(409)
        const body = await json<Record<string, unknown>>(response)
        expect(Object.keys(body).sort()).toEqual([
          'detail',
          'request_id',
          'status',
          'title',
          'type',
        ])
        expect(body).toMatchObject({ type: 'urn:embertrail:problem:conflict', status: 409 })
        expect(JSON.stringify(body)).not.toMatch(/bob|secret/)
      })

      it('answers 409 even to If-None-Match: *, and leaves the document alone', async () => {
        expect((await put(alice, doc, 1, { 'if-none-match': '*' })).status).toBe(409)
        const [row] = await t.sql<{ owner_id: string; data: unknown }>(
          sql`select owner_id, data from store.documents`,
        )
        expect(row).toEqual({ owner_id: 'bob', data: { secret: 'bob' } })
      })

      it('is otherwise invisible: 404 to read or delete, absent from lists', async () => {
        expect((await alice.get(doc)).status).toBe(404)
        expect((await alice.delete(doc)).status).toBe(404)
        expect(await json(await alice.get('/api/v1/store/notes'))).toEqual({
          items: [],
          next_cursor: null,
        })
      })
    })

    describe('lists', () => {
      beforeEach(async () => {
        for (const id of ['a', 'b', 'c', 'd', 'e']) {
          await put(alice, `/api/v1/store/notes/${id}`, id)
          later(1)
        }
        // Same updated_at as e: the id breaks the tie.
        time = new Date(time.getTime() - 1000)
        await put(alice, '/api/v1/store/notes/f', 'f')
        await put(alice, '/api/v1/store/other/z', 'z')
        await put(t.as('bob', scopes), '/api/v1/store/notes/bob', 'bob')
      })

      it('pages through the namespace, most recently updated first', async () => {
        const seen: string[] = []
        let cursor: string | null = null
        do {
          const query: string = cursor === null ? '' : `&cursor=${cursor}`
          const page = await json<Page>(await alice.get(`/api/v1/store/notes?limit=2${query}`))
          expect(page.items.length).toBeLessThanOrEqual(2)
          seen.push(...page.items.map((d) => d.id))
          cursor = page.next_cursor
        } while (cursor !== null)
        expect(seen).toEqual(['f', 'e', 'd', 'c', 'b', 'a'])
      })

      it('moves a replaced document to the front', async () => {
        later(10)
        await put(alice, '/api/v1/store/notes/a', 'again')
        const page = await json<Page>(await alice.get('/api/v1/store/notes?limit=1'))
        expect(page.items.map((d) => d.id)).toEqual(['a'])
      })

      it('answers 400 invalid-cursor to a cursor it did not issue for this namespace', async () => {
        const page = await json<Page>(await alice.get('/api/v1/store/notes?limit=1'))
        for (const path of [
          '/api/v1/store/notes?cursor=nonsense',
          `/api/v1/store/notes?cursor=${btoa('[1,2,3]')}`,
          `/api/v1/store/other?cursor=${page.next_cursor ?? ''}`,
        ]) {
          const response = await alice.get(path)
          expect(response.status).toBe(400)
          expect(await json(response)).toMatchObject({
            type: 'urn:embertrail:problem:invalid-cursor',
          })
        }
      })

      it('validates limit', async () => {
        expect((await alice.get('/api/v1/store/notes?limit=0')).status).toBe(400)
        expect((await alice.get('/api/v1/store/notes?limit=1001')).status).toBe(400)
      })
    })

    it('refuses an owner_id the Module did not let the database stamp', async () => {
      const forged = t.db.transaction({ role: 'app', userId: 'alice', ownerId: 'alice' }, (db) =>
        db.execute(sql`insert into store.documents
          (namespace, id, version, created_at, updated_at, data, owner_id)
          values ('notes', 'forged', 1, now(), now(), '1', 'bob')`),
      )
      // Drizzle wraps the driver's error; the database's refusal is its cause.
      await expect(forged).rejects.toMatchObject({
        cause: { message: expect.stringMatching(/row-level security/) as unknown },
      })
      expect(await t.sql(sql`select id from store.documents`)).toEqual([])
    })

    it('needs store:write to write and store:read to read', async () => {
      const reader = t.as('alice', ['store:read'])
      expect((await put(reader, doc, 1)).status).toBe(403)
      expect((await reader.delete(doc)).status).toBe(403)
      await put(alice, doc, 1)
      expect((await t.as('alice', ['store:write']).get(doc)).status).toBe(403)
      expect((await reader.get(doc)).status).toBe(200)
    })
  })

  describe('Team documents', () => {
    const team = '/api/v1/store/notes/shared'
    let t: TestHub
    let editor: TestClient
    let member: TestClient
    let outsider: TestClient

    beforeEach(async () => {
      t = await testHub({ modules: [store] })
      await t.team('crew', { editors: ['erin'], members: ['carol'] })
      editor = t.as('erin', scopes, { team: 'crew' })
      member = t.as('carol', scopes)
      outsider = t.as('dave', scopes)
    })
    afterEach(async () => {
      await t.close()
    })

    it('lets an editor create a Team document with Embertrail-Owner: team:<id>', async () => {
      const created = await put(editor, team, { a: 1 }, { 'embertrail-owner': 'team:crew' })
      expect(created.status).toBe(201)
      expect((await json<StoreDocument>(created)).owner).toEqual({ kind: 'team', id: 'crew' })
    })

    it('lets an editor replace a Team document, which keeps its Team Owner', async () => {
      await put(editor, team, 1, { 'embertrail-owner': 'team:crew' })
      const replaced = await put(editor, team, 2)
      expect(replaced.status).toBe(200)
      const body = await json<StoreDocument>(replaced)
      expect(body.owner).toEqual({ kind: 'team', id: 'crew' })
      expect(body.version).toBe(2)
    })

    it('lets a member read a Team document but not write it (403)', async () => {
      await put(editor, team, 1, { 'embertrail-owner': 'team:crew' })
      expect((await member.get(team)).status).toBe(200)
      expect((await put(member, team, 2)).status).toBe(403)
      expect((await member.delete(team)).status).toBe(403)
      expect(
        (await put(member, '/api/v1/store/notes/new', 1, { 'embertrail-owner': 'team:crew' }))
          .status,
      ).toBe(403)
    })

    it('answers 404 to a non-member', async () => {
      await put(editor, team, 1, { 'embertrail-owner': 'team:crew' })
      expect((await outsider.get(team)).status).toBe(404)
      expect((await outsider.delete(team)).status).toBe(404)
      expect((await put(outsider, team, 2)).status).toBe(409)
    })
  })
})
