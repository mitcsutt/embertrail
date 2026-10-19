import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { assertModuleContract, testHub } from '../testing/index'
import type { TestHub } from '../testing/index'
import { notes } from './notes'

describe('the example notes Module', () => {
  it('passes the Module contract suite', async () => {
    await assertModuleContract(notes, {
      async seed(client) {
        expect((await client.post('/api/v1/notes', { title: 'First' })).status).toBe(200)
      },
    })
  })

  describe('through HTTP', () => {
    let t: TestHub

    beforeEach(async () => {
      t = await testHub({ modules: [notes], clock: () => new Date('2026-10-19T09:00:00Z') })
    })

    afterEach(async () => {
      await t.close()
    })

    it('creates, lists, reads and deletes a note', async () => {
      const alice = t.as('alice', ['notes:read', 'notes:write'])
      const created = await alice.post('/api/v1/notes', { title: 'Groceries', body: 'eggs' })
      expect(created.status).toBe(200)
      const note = (await created.json()) as { id: string }
      expect(note).toMatchObject({ title: 'Groceries', created_at: '2026-10-19T09:00:00.000Z' })

      const listed = (await (await alice.get('/api/v1/notes')).json()) as { notes: unknown[] }
      expect(listed.notes).toHaveLength(1)
      expect((await alice.get(`/api/v1/notes/${note.id}`)).status).toBe(200)

      expect((await alice.delete(`/api/v1/notes/${note.id}`)).status).toBe(200)
      expect((await alice.get(`/api/v1/notes/${note.id}`)).status).toBe(404)
    })

    it('keeps each User’s notes to themselves', async () => {
      const alice = t.as('alice', ['notes:read', 'notes:write'])
      const { id } = (await (await alice.post('/api/v1/notes', { title: 'Mine' })).json()) as {
        id: string
      }
      const bob = t.as('bob', ['notes:read', 'notes:write'])
      expect(await (await bob.get('/api/v1/notes')).json()).toEqual({ notes: [] })
      expect((await bob.get(`/api/v1/notes/${id}`)).status).toBe(404)
      expect((await bob.delete(`/api/v1/notes/${id}`)).status).toBe(404)
    })

    it('derives its Scopes from its ops', () => {
      expect(notes.scopes).toEqual(['notes:read', 'notes:write'])
    })
  })
})
