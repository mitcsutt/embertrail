import assert from 'node:assert/strict'

import { sql } from 'drizzle-orm'

import type { Check } from '../contract/index'
import { rows } from '../db/port'
import type { DbSession } from '../db/port'
import type { Scope } from '../module/define'
import type { ClosableDbPort } from './pglite'
import { probe } from './probe'
import { testHub } from './test-hub'
import type { TestClient, TestHub } from './test-hub'

// Core identity's row-level security (#29), proven against a real database: a Grant reads one
// Module's rows for one Account, Teams read their rows, and only editors act for a Team.

type OpenDb = () => Promise<ClosableDbPort>

const alpha = probe('alpha')
const beta = probe('beta')
const writeBoth: Scope[] = ['alpha:read', 'alpha:write', 'beta:read', 'beta:write']
const readBoth: Scope[] = ['alpha:read', 'beta:read']

const work = { 'organization.id': 'org-1', 'user.account_uuid': 'acct-1' }
const personal = { 'user.email': 'alice@personal.test' }

async function withProbes(open: OpenDb, fn: (t: TestHub) => Promise<void>) {
  const t = await testHub({ modules: [alpha, beta], db: await open() })
  try {
    await fn(t)
  } finally {
    await t.close()
  }
}

async function json<T>(response: Response) {
  assert.equal(response.status, 200, `expected 200, got ${String(response.status)}`)
  return (await response.json()) as T
}

const values = async (client: TestClient, module: 'alpha' | 'beta') =>
  (
    await json<{ signals: { value: number }[] }>(await client.get(`/api/v1/${module}/signals`))
  ).signals
    .map((s) => s.value)
    .sort()

/** Alice's laptop sends 1 (work) and 2 (personal) to alpha, and 3 (work) and 4 to beta. */
async function seedAlice(t: TestHub) {
  const laptop = t.as('alice', writeBoth, { sourceId: 'laptop' })
  for (const [module, value, attributes] of [
    ['alpha', 1, work],
    ['alpha', 2, personal],
    ['beta', 3, work],
    ['beta', 4, personal],
  ] as const) {
    await json(await laptop.post(`/api/v1/${module}/signals`, { value, attributes }))
  }
  const [account] = await t.sql<{ id: string }>(
    sql`select id from core.accounts where key = 'account:org-1/acct-1'`,
  )
  assert.ok(account, 'the work Account was not recognised')
  return account.id
}

/** What a session sees and may change directly, under row-level security. */
async function asSession(t: TestHub, session: DbSession, table: string) {
  const [seen] = await t.db.transaction(session, (db) =>
    rows<{ values: number[] | null }>(
      db,
      sql`select array_agg(value order by value) as values from ${sql.raw(table)}`,
    ),
  )
  return seen?.values ?? []
}

export const identityInvariantChecks: readonly Check<OpenDb>[] = [
  {
    name: 'a Grant lets the grantee read exactly one Module’s rows for one Account',
    run: (open) =>
      withProbes(open, async (t) => {
        const workAccount = await seedAlice(t)
        await t.user('bob')
        const bob = t.as('bob', readBoth)
        assert.deepEqual(await values(bob, 'alpha'), [])

        const grant = await t.hub.directory.grant({
          module: 'alpha',
          accountId: workAccount,
          userId: 'bob',
        })
        assert.deepEqual(await values(bob, 'alpha'), [1])
        assert.deepEqual(await values(bob, 'beta'), [])
        // The same, straight against the database: the read-only role and the app role.
        for (const role of ['readonly', 'app'] as const) {
          const session: DbSession = { role, userId: 'bob', ownerId: 'bob' }
          assert.deepEqual(await asSession(t, session, 'alpha.signals'), [1], role)
          assert.deepEqual(await asSession(t, session, 'beta.signals'), [], role)
        }
        // A Grant reads; it never writes.
        const changed = await t.db.transaction(
          { role: 'app', userId: 'bob', ownerId: 'bob' },
          async (db) => [
            ...(await rows(db, sql`update alpha.signals set value = 9 returning id`)),
            ...(await rows(db, sql`delete from alpha.signals returning id`)),
          ],
        )
        assert.deepEqual(changed, [])

        await t.hub.directory.revokeGrant(grant.id)
        assert.deepEqual(await values(bob, 'alpha'), [])
        assert.deepEqual(await values(t.as('alice', readBoth), 'alpha'), [1, 2])
      }),
  },
  {
    name: 'a Grant to a Team lets its members read, and nobody else',
    run: (open) =>
      withProbes(open, async (t) => {
        const workAccount = await seedAlice(t)
        await t.team('crew', { members: ['carol'], editors: ['erin'] })
        await t.hub.directory.grant({ module: 'beta', accountId: workAccount, teamId: 'crew' })
        assert.deepEqual(await values(t.as('carol', readBoth), 'beta'), [3])
        assert.deepEqual(await values(t.as('erin', readBoth), 'beta'), [3])
        assert.deepEqual(await values(t.as('carol', readBoth), 'alpha'), [])
        assert.deepEqual(await values(t.as('dave', readBoth), 'beta'), [])
        await t.hub.directory.removeTeamMember('crew', 'carol')
        assert.deepEqual(await values(t.as('carol', readBoth), 'beta'), [])
      }),
  },
  {
    name: 'Team members read the Team’s rows; only an editor acts for the Team',
    run: (open) =>
      withProbes(open, async (t) => {
        await t.team('crew', { editors: ['erin'], members: ['carol'] })
        const erin = t.as('erin', writeBoth, { team: 'crew' })
        const created = await json<{ ownerId: string }>(
          await erin.post('/api/v1/alpha/notes', { note: 'for the crew' }),
        )
        assert.equal(created.ownerId, 'crew')
        await json(await t.as('erin', writeBoth).post('/api/v1/alpha/notes', { note: 'mine' }))

        const notes = async (client: TestClient) =>
          (await json<{ notes: { note: string }[] }>(await client.get('/api/v1/alpha/notes'))).notes
            .map((n) => n.note)
            .sort()
        assert.deepEqual(await notes(t.as('carol', writeBoth)), ['for the crew'])
        assert.deepEqual(await notes(t.as('erin', writeBoth)), ['for the crew', 'mine'])
        assert.deepEqual(await notes(t.as('dave', writeBoth)), [])

        const refused = async (client: TestClient, status: number) => {
          const response = await client.post('/api/v1/alpha/notes', { note: 'x' })
          assert.equal(response.status, status)
        }
        await refused(t.as('carol', writeBoth, { team: 'crew' }), 403)
        await refused(t.as('dave', writeBoth, { team: 'crew' }), 403)
        await refused(t.as('erin', writeBoth, { team: 'nobody' }), 403)
        // A Source's Signals always belong to its User.
        await refused(t.as('erin', writeBoth, { sourceId: 'laptop', team: 'crew' }), 403)
        const malformed = await t
          .as('erin', writeBoth)
          .fetch('/api/v1/alpha/notes', { headers: { 'embertrail-owner': 'crew' } })
        assert.equal(malformed.status, 400)
        const [count] = await t.sql<{ count: number }>(
          sql`select count(*)::int as count from alpha.notes where owner_id = 'crew'`,
        )
        assert.equal(count?.count, 1)
      }),
  },
]
