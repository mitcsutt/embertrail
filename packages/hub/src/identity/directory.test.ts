import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { HubError } from '../module/errors'
import { probe } from '../testing/probe'
import { testHub } from '../testing/test-hub'
import type { TestHub } from '../testing/test-hub'
import { hashSecret, parseToken } from './tokens'

const alpha = probe('alpha')

async function problem(work: Promise<unknown>) {
  const error = await work.then(
    () => undefined,
    (e: unknown) => e,
  )
  if (!(error instanceof HubError)) throw new Error(`expected a HubError, got ${String(error)}`)
  return { status: error.status, detail: error.detail }
}

describe('the core Directory', () => {
  let t: TestHub

  beforeEach(async () => {
    t = await testHub({ modules: [alpha] })
  })

  afterEach(async () => {
    await t.close()
  })

  const directory = () => t.hub.directory

  describe('Tokens', () => {
    it('stores only the secret’s SHA-256 hash and shows the secret once', async () => {
      const user = await directory().createUser({ name: 'Alice' })
      const issued = await directory().issueToken(user.id, {
        kind: 'management',
        scopes: ['alpha:read', 'self:manage'],
        name: 'laptop CLI',
      })
      const parsed = parseToken(issued.token)
      expect(parsed?.id).toBe(issued.record.id)
      expect(issued.record).toMatchObject({
        userId: user.id,
        kind: 'management',
        sourceId: null,
        scopes: ['alpha:read', 'self:manage'],
        name: 'laptop CLI',
        expiresAt: null,
        revokedAt: null,
      })
      expect(issued.record).not.toHaveProperty('secret')
      const [row] = await t.sql<Record<string, unknown>>(
        sql`select * from core.tokens where id = ${issued.record.id}`,
      )
      expect(row?.secret_hash).toBe(await hashSecret(parsed?.secret ?? ''))
      // No column holds the secret or the Token.
      for (const value of Object.values(row ?? {})) {
        expect(JSON.stringify(value)).not.toContain(parsed?.secret)
      }
    })

    it('cannot create an ingest Token without a Source binding', async () => {
      const user = await directory().createUser({ name: 'Alice' })
      expect(
        await problem(directory().issueToken(user.id, { kind: 'ingest', scopes: ['alpha:write'] })),
      ).toEqual({ status: 422, detail: 'An ingest Token must be bound to a Source' })
      // The database refuses it too, whoever writes the row.
      await expect(
        t.sql(
          sql`insert into core.tokens (id, user_id, kind, scopes, secret_hash)
            values ('tok', ${user.id}, 'ingest', '{alpha:write}', 'x')`,
        ),
      ).rejects.toThrow()
      expect(await t.sql(sql`select id from core.tokens`)).toEqual([])
    })

    it('binds an ingest Token to exactly one Source of its own User', async () => {
      const alice = await directory().createUser({ name: 'Alice' })
      const bob = await directory().createUser({ name: 'Bob' })
      const laptop = await directory().createSource(alice.id, { name: 'laptop' })
      const issued = await directory().issueToken(alice.id, {
        kind: 'ingest',
        scopes: ['alpha:write'],
        sourceId: laptop.id,
      })
      expect(issued.record.sourceId).toBe(laptop.id)
      expect(
        await problem(
          directory().issueToken(bob.id, {
            kind: 'ingest',
            scopes: ['alpha:write'],
            sourceId: laptop.id,
          }),
        ),
      ).toMatchObject({ status: 404 })
    })

    it('never binds a read or management Token to a Source', async () => {
      const user = await directory().createUser({ name: 'Alice' })
      const laptop = await directory().createSource(user.id, { name: 'laptop' })
      for (const kind of ['read', 'management'] as const) {
        expect(
          await problem(
            directory().issueToken(user.id, { kind, scopes: ['alpha:read'], sourceId: laptop.id }),
          ),
        ).toEqual({ status: 422, detail: `A ${kind} Token cannot be bound to a Source` })
      }
    })

    it('refuses an unknown Scope, no Scopes, and admin for a User who isn’t one', async () => {
      const user = await directory().createUser({ name: 'Alice' })
      const issue = (scopes: Parameters<TestHub['as']>[1]) =>
        problem(directory().issueToken(user.id, { kind: 'management', scopes }))
      expect(await issue(['beta:read'])).toEqual({ status: 422, detail: 'Unknown Scope beta:read' })
      expect(await issue([])).toEqual({ status: 422, detail: 'A Token needs at least one Scope' })
      expect(await issue(['admin'])).toEqual({
        status: 422,
        detail: 'Only an admin User may hold the admin Scope',
      })
    })

    it('drops admin from a Token once its User is no longer an admin', async () => {
      const root = t.as('root', ['admin', 'alpha:read'])
      const scopes = async () =>
        ((await (await root.get('/api/v1/alpha/whoami')).json()) as { scopes: string[] }).scopes
      expect(await scopes()).toEqual(['admin', 'alpha:read'])
      await t.sql(sql`update core.users set admin = false where id = 'root'`)
      expect(await scopes()).toEqual(['alpha:read'])
    })
  })

  describe('Users, Teams and Sources', () => {
    it('creates Users with lowercased, unique emails', async () => {
      const user = await directory().createUser({ name: 'Alice', email: 'Alice@Example.com' })
      expect(user).toMatchObject({ name: 'Alice', email: 'alice@example.com', admin: false })
      expect(
        await problem(directory().createUser({ name: 'Other', email: 'alice@example.com' })),
      ).toMatchObject({ status: 409 })
    })

    it('names a User’s Sources uniquely, per User', async () => {
      const alice = await directory().createUser({ name: 'Alice' })
      const bob = await directory().createUser({ name: 'Bob' })
      await directory().createSource(alice.id, { name: 'laptop' })
      await directory().createSource(bob.id, { name: 'laptop' })
      expect(await problem(directory().createSource(alice.id, { name: 'laptop' }))).toMatchObject({
        status: 409,
      })
      expect(await problem(directory().createSource('nobody', { name: 'x' }))).toEqual({
        status: 404,
        detail: 'No User nobody',
      })
    })

    it('adds Team members, changes their role and removes them', async () => {
      const alice = await directory().createUser({ name: 'Alice' })
      const team = await directory().createTeam({ name: 'Crew' })
      expect(team.id).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
      await directory().setTeamMember(team.id, alice.id, 'member')
      await directory().setTeamMember(team.id, alice.id, 'editor')
      expect(await t.sql(sql`select role from core.team_members`)).toEqual([{ role: 'editor' }])
      await directory().removeTeamMember(team.id, alice.id)
      expect(await t.sql(sql`select role from core.team_members`)).toEqual([])
      expect(await problem(directory().createTeam({ name: 'Crew' }))).toMatchObject({
        status: 409,
      })
      expect(await problem(directory().createTeam({ name: 'Bad', id: 'team:x' }))).toMatchObject({
        status: 422,
      })
    })
  })

  describe('Grants', () => {
    it('go to exactly one User or one Team, for a Module the Hub loads', async () => {
      const alice = await directory().createUser({ name: 'Alice' })
      expect(
        await problem(directory().grant({ module: 'beta', accountId: 'a', userId: alice.id })),
      ).toEqual({ status: 422, detail: 'No Module "beta"' })
      expect(await problem(directory().grant({ module: 'alpha', accountId: 'a' }))).toEqual({
        status: 422,
        detail: 'A Grant is to exactly one User or one Team',
      })
      expect(
        await problem(directory().grant({ module: 'alpha', accountId: 'a', userId: alice.id })),
      ).toEqual({ status: 404, detail: 'No such Account, User or Team' })
    })
  })
})
