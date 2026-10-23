import assert from 'node:assert/strict'

import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { probe } from '../testing/probe'
import { testHub } from '../testing/test-hub'
import type { TestClient, TestHub } from '../testing/test-hub'
import { coreOps } from './ops'

const alpha = probe('alpha')

async function body<T = Record<string, unknown>>(response: Response | Promise<Response>) {
  return (await (await response).json()) as T
}

/** A problem response's status and `type` slug. */
async function problem(response: Response | Promise<Response>) {
  const answered = await response
  const { type } = await body<{ type: string }>(answered)
  return { status: answered.status, type: type.replace('urn:embertrail:problem:', '') }
}

/** Every path with its parameters filled in, so each op can be called. */
const filled = (path: string) => path.replaceAll(/\{[^}]+\}/g, 'x')

const call = (client: TestClient, method: string, path: string) =>
  client.fetch(path, {
    method,
    ...(method === 'GET' || method === 'DELETE'
      ? {}
      : { body: '{}', headers: { 'content-type': 'application/json' } }),
  })

describe('the Admin and self-management API', () => {
  let t: TestHub

  beforeEach(async () => {
    t = await testHub({ modules: [alpha] })
  })

  afterEach(async () => {
    const { errors } = t
    await t.close()
    assert.deepEqual(errors, [], 'the Hub answered with a 500')
  })

  /** Rows an Owner owns, or a Source sent, across the probe Module's tables. */
  async function holdings(column: 'owner_id' | 'source_id', value: string) {
    const [found] = await t.sql<{ count: number }>(
      column === 'owner_id'
        ? sql`select ((select count(*) from alpha.signals where owner_id = ${value})
            + (select count(*) from alpha.notes where owner_id = ${value}))::int as count`
        : sql`select count(*)::int as count from alpha.signals where source_id = ${value}`,
    )
    return found?.count
  }

  describe('Scopes', () => {
    it.each(coreOps.map((op) => [`${op.method} ${op.path}`, op] as const))(
      '%s needs a Token or Edge Identity, then its Scope',
      async (_, op) => {
        const path = filled(op.path)
        expect(await problem(call(t.anonymous, op.method, path))).toEqual({
          status: 401,
          type: 'unauthenticated',
        })
        const other = op.scope === 'admin' ? 'self:manage' : 'alpha:read'
        expect(await problem(call(t.as('carol', [other]), op.method, path))).toEqual({
          status: 403,
          type: 'forbidden',
        })
      },
    )

    it('only an Admin holds admin, so a demoted admin loses the Admin API', async () => {
      const ada = t.as('ada', ['admin'])
      expect((await ada.get('/api/v1/admin/users')).status).toBe(200)
      await t.sql(sql`update core.users set admin = false where id = 'ada'`)
      expect(await problem(ada.get('/api/v1/admin/users'))).toEqual({
        status: 403,
        type: 'forbidden',
      })
    })
  })

  describe('Users', () => {
    it('creates a User with a management Token holding every Scope but admin', async () => {
      const ada = t.as('ada', ['admin'])
      const created = await ada.post('/api/v1/admin/users', { name: 'Bob' })
      expect(created.status).toBe(201)
      const { user, token } = await body<{ user: { id: string }; token: string }>(created)
      expect(user).toMatchObject({ name: 'Bob', email: null, admin: false })
      const whoami = await t.anonymous.fetch('/api/v1/alpha/whoami', {
        headers: { authorization: `Bearer ${token}` },
      })
      expect(await body(whoami)).toMatchObject({
        userId: user.id,
        scopes: ['alpha:read', 'alpha:write', 'self:manage', 'sql:read'],
      })

      const users = await body<{ items: { id: string }[] }>(ada.get('/api/v1/admin/users'))
      expect(users.items.map((u) => u.id)).toEqual(['ada', user.id])
    })

    it('creates an admin, or a User with only an email, with no Token', async () => {
      const ada = t.as('ada', ['admin'])
      const admin = await body(ada.post('/api/v1/admin/users', { name: 'Cy', admin: true }))
      expect(admin).toMatchObject({ user: { admin: true } })
      const edge = await ada.post('/api/v1/admin/users', {
        name: 'Di',
        email: 'Di@Example.com',
        token: false,
      })
      expect(await body(edge)).toMatchObject({
        user: { email: 'di@example.com', admin: false },
        token: null,
      })
      expect(
        await t.sql(sql`select id from core.tokens where name = 'created by an admin'`),
      ).toHaveLength(1)
    })

    it('never issues a new User a Token that outlives the calling Token', async () => {
      const ada = t.as('ada', ['admin', 'self:manage'])
      const short = new Date(Date.now() + 3_600_000).toISOString()
      const expiring = await body<{ token: string }>(
        ada.post('/api/v1/self/tokens', {
          kind: 'management',
          scopes: ['admin'],
          expires_at: short,
        }),
      )
      const create = (
        client: (path: string, init: RequestInit) => Promise<Response>,
        name: string,
      ) =>
        body<{ user: { id: string } }>(
          client('/api/v1/admin/users', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name }),
          }),
        )
      const expiryOf = async (userId: string) =>
        (
          await t.sql<{ expires_at: string | null }>(
            sql`select expires_at::text from core.tokens where user_id = ${userId}`,
          )
        ).map((row) => (row.expires_at === null ? null : new Date(row.expires_at).toISOString()))

      const capped = await create(
        (path, init) =>
          t.anonymous.fetch(path, {
            ...init,
            headers: new Headers({
              ...Object.fromEntries(new Headers(init.headers)),
              authorization: `Bearer ${expiring.token}`,
            }),
          }),
        'Cy',
      )
      expect(await expiryOf(capped.user.id)).toEqual([short])
      const unbounded = await create((path, init) => ada.fetch(path, init), 'Di')
      expect(await expiryOf(unbounded.user.id)).toEqual([null])
    })

    it('refuses a duplicate email (409) and a malformed one (400)', async () => {
      const ada = t.as('ada', ['admin'])
      await ada.post('/api/v1/admin/users', { name: 'Bob', email: 'bob@example.com' })
      expect(
        await problem(ada.post('/api/v1/admin/users', { name: 'Bo', email: 'BOB@example.com' })),
      ).toEqual({ status: 409, type: 'conflict' })
      expect(
        await problem(ada.post('/api/v1/admin/users', { name: 'Bo', email: 'not-an-email' })),
      ).toEqual({ status: 400, type: 'validation' })
      expect(
        await problem(ada.post('/api/v1/admin/users', { name: 'Bo', owner: 'unknown key' })),
      ).toEqual({ status: 400, type: 'validation' })
    })

    it('deletes a User and leaves zero rows they own', async () => {
      const bob = t.as('bob', ['alpha:write'], { sourceId: 'bob-laptop' })
      await bob.post('/api/v1/alpha/signals', { value: 1, attributes: { 'user.email': 'b@x.io' } })
      await bob.post('/api/v1/alpha/signals', { value: 2 })
      await t.as('bob', ['alpha:write']).post('/api/v1/alpha/notes', { note: 'mine' })
      const carol = t.as('carol', ['alpha:write'], { sourceId: 'carol-laptop' })
      await carol.post('/api/v1/alpha/signals', { value: 3 })
      const [account] = await t.sql<{ id: string }>(
        sql`select id from core.accounts where owner_id = 'bob' and email = 'b@x.io'`,
      )
      await t.hub.directory.grant({
        module: 'alpha',
        accountId: account?.id ?? '',
        userId: 'carol',
      })
      await t.team('crew', { members: ['bob', 'carol'] })
      expect(await holdings('owner_id', 'bob')).toBe(3)

      const response = await t.as('ada', ['admin']).delete('/api/v1/admin/users/bob')

      expect(response.status).toBe(204)
      expect(await holdings('owner_id', 'bob')).toBe(0)
      for (const table of ['users', 'sources', 'tokens', 'accounts', 'team_members']) {
        const column =
          table === 'users'
            ? 'id'
            : table === 'sources' || table === 'accounts'
              ? 'owner_id'
              : 'user_id'
        expect(
          await t.sql(
            sql`select 1 from ${sql.raw(`core.${table}`)} where ${sql.raw(column)} = 'bob'`,
          ),
        ).toEqual([])
      }
      expect(await t.sql(sql`select 1 from core.grants`)).toEqual([])
      // Bob's Tokens no longer authenticate; Carol keeps her data.
      expect(await problem(bob.post('/api/v1/alpha/signals', { value: 4 }))).toEqual({
        status: 401,
        type: 'unauthenticated',
      })
      expect(await holdings('owner_id', 'carol')).toBe(1)
    })

    it('refuses to delete the caller’s own User (422) or an unknown one (404)', async () => {
      const ada = t.as('ada', ['admin'])
      expect(await problem(ada.delete('/api/v1/admin/users/ada'))).toEqual({
        status: 422,
        type: 'invalid',
      })
      expect(await problem(ada.delete('/api/v1/admin/users/nobody'))).toEqual({
        status: 404,
        type: 'not-found',
      })
    })

    it('never deletes a Team’s rows through a User delete aimed at the Team’s id', async () => {
      await t.team('crew', { editors: ['bob'] })
      await t
        .as('bob', ['alpha:write'], { team: 'crew' })
        .post('/api/v1/alpha/notes', { note: 'n' })
      expect(await problem(t.as('ada', ['admin']).delete('/api/v1/admin/users/crew'))).toEqual({
        status: 404,
        type: 'not-found',
      })
      expect(await holdings('owner_id', 'crew')).toBe(1)
    })
  })

  describe('Teams', () => {
    it('creates a Team, sets roles, lists members and removes one', async () => {
      const ada = t.as('ada', ['admin'])
      await t.user('bob')
      await t.user('carol')
      const created = await ada.post('/api/v1/admin/teams', { id: 'crew', name: 'The Crew' })
      expect(created.status).toBe(201)
      expect(await body(created)).toEqual({ id: 'crew', name: 'The Crew' })

      const put = await ada.put('/api/v1/admin/teams/crew/members/bob', { role: 'editor' })
      expect(await body(put)).toEqual({ team_id: 'crew', user_id: 'bob', role: 'editor' })
      await ada.put('/api/v1/admin/teams/crew/members/carol', { role: 'editor' })
      await ada.put('/api/v1/admin/teams/crew/members/carol', { role: 'member' })
      expect(await body(ada.get('/api/v1/admin/teams'))).toEqual({
        items: [
          {
            id: 'crew',
            name: 'The Crew',
            members: [
              { user_id: 'bob', role: 'editor' },
              { user_id: 'carol', role: 'member' },
            ],
          },
        ],
      })

      // An editor acts for the Team; a member doesn't.
      const asCrew = (id: string) => t.as(id, ['alpha:write'], { team: 'crew' })
      expect((await asCrew('bob').post('/api/v1/alpha/notes', { note: 'n' })).status).toBe(200)
      expect((await asCrew('carol').post('/api/v1/alpha/notes', { note: 'n' })).status).toBe(403)

      expect((await ada.delete('/api/v1/admin/teams/crew/members/bob')).status).toBe(204)
      expect((await asCrew('bob').post('/api/v1/alpha/notes', { note: 'n' })).status).toBe(403)
      expect(await problem(ada.delete('/api/v1/admin/teams/crew/members/bob'))).toEqual({
        status: 404,
        type: 'not-found',
      })
    })

    it('generates an id when none is given', async () => {
      const team = await body<{ id: string }>(
        t.as('ada', ['admin']).post('/api/v1/admin/teams', { name: 'Anon' }),
      )
      expect(team.id).toMatch(/^[0-9a-f-]{36}$/)
    })

    it('answers 409 for a taken id or name, 400 for a bad id, 404 for an unknown member', async () => {
      const ada = t.as('ada', ['admin'])
      await ada.post('/api/v1/admin/teams', { id: 'crew', name: 'Crew' })
      expect(await problem(ada.post('/api/v1/admin/teams', { id: 'crew', name: 'Other' }))).toEqual(
        { status: 409, type: 'conflict' },
      )
      expect(await problem(ada.post('/api/v1/admin/teams', { id: 'ada', name: 'Ada' }))).toEqual({
        status: 409,
        type: 'conflict',
      })
      expect(await problem(ada.post('/api/v1/admin/teams', { id: 'a b', name: 'X' }))).toEqual({
        status: 400,
        type: 'validation',
      })
      expect(
        await problem(ada.put('/api/v1/admin/teams/crew/members/nobody', { role: 'member' })),
      ).toEqual({ status: 404, type: 'not-found' })
      expect(
        await problem(ada.put('/api/v1/admin/teams/crew/members/ada', { role: 'owner' })),
      ).toEqual({ status: 400, type: 'validation' })
    })

    it('deletes a Team and everything it owns, but not its members’ own rows', async () => {
      await t.team('crew', { editors: ['bob'] })
      const bob = t.as('bob', ['alpha:write'])
      await t
        .as('bob', ['alpha:write'], { team: 'crew' })
        .post('/api/v1/alpha/notes', { note: 'n' })
      await bob.post('/api/v1/alpha/notes', { note: 'mine' })
      const ada = t.as('ada', ['admin'])

      expect((await ada.delete('/api/v1/admin/teams/crew')).status).toBe(204)

      expect(await holdings('owner_id', 'crew')).toBe(0)
      expect(await holdings('owner_id', 'bob')).toBe(1)
      expect(await t.sql(sql`select 1 from core.team_members`)).toEqual([])
      expect(await problem(ada.delete('/api/v1/admin/teams/crew'))).toEqual({
        status: 404,
        type: 'not-found',
      })
    })
  })

  describe('Sources', () => {
    it('lists every User’s Sources and deletes any of them with its Signals', async () => {
      const bob = t.as('bob', ['alpha:write'], { sourceId: 'bob-laptop' })
      await bob.post('/api/v1/alpha/signals', { value: 1 })
      await t
        .as('bob', ['alpha:write'], { sourceId: 'bob-desktop' })
        .post('/api/v1/alpha/signals', {
          value: 2,
        })
      await t
        .as('carol', ['alpha:write'], { sourceId: 'carol-laptop' })
        .post('/api/v1/alpha/signals', { value: 3 })
      const ada = t.as('ada', ['admin'])

      expect(await body(ada.get('/api/v1/admin/sources'))).toEqual({
        items: [
          { id: 'bob-laptop', owner_id: 'bob', name: 'bob-laptop' },
          { id: 'bob-desktop', owner_id: 'bob', name: 'bob-desktop' },
          { id: 'carol-laptop', owner_id: 'carol', name: 'carol-laptop' },
        ],
      })

      expect((await ada.delete('/api/v1/admin/sources/bob-laptop')).status).toBe(204)

      expect(await holdings('source_id', 'bob-laptop')).toBe(0)
      expect(await holdings('source_id', 'bob-desktop')).toBe(1)
      expect(await holdings('source_id', 'carol-laptop')).toBe(1)
      // Its ingest Token went with it.
      expect(await problem(bob.post('/api/v1/alpha/signals', { value: 4 }))).toEqual({
        status: 401,
        type: 'unauthenticated',
      })
      expect(await problem(ada.delete('/api/v1/admin/sources/bob-laptop'))).toEqual({
        status: 404,
        type: 'not-found',
      })
    })
  })
})
