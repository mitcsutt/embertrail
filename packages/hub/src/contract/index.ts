// Adapter contract suites (#26): every Adapter of a Port passes the same checks. Each check
// throws on failure, so any runner can drive them, including Vitest in workerd:
//
//   for (const check of dbPortChecks) it(check.name, () => check.run(port))

import assert from 'node:assert/strict'

import { sql } from 'drizzle-orm'

import { migrate } from '../db/migrate'
import { dbRoles, rows } from '../db/port'
import type { DbPort, DbSession } from '../db/port'
import { EdgeIdentityError } from '../identity/edge'
import type { EdgeIdentityPort } from '../identity/edge'

/** One named contract check against a subject. */
export interface Check<T> {
  name: string
  run(subject: T): Promise<void>
}

interface Settings {
  role: string
  user_id: string | null
  owner_id: string | null
  source_id: string | null
  statement_timeout: string
}

const readSettings = sql`select current_user as role,
  current_setting('embertrail.user_id', true) as user_id,
  current_setting('embertrail.owner_id', true) as owner_id,
  current_setting('embertrail.source_id', true) as source_id,
  current_setting('statement_timeout') as statement_timeout`

const alice: DbSession = { role: 'app', userId: 'alice', ownerId: 'team-a', sourceId: 'laptop' }

class Marker extends Error {}

/** A scratch table the checks can write to, as the connecting role and as the app role. */
async function probe(port: DbPort) {
  await migrate(port, [])
  await port.privileged(async (db) => {
    await db.execute(sql`create schema if not exists port_contract`)
    await db.execute(sql`create table if not exists port_contract.probe (note text)`)
    await db.execute(sql.raw(`grant usage on schema port_contract to ${dbRoles.app}`))
    await db.execute(sql.raw(`grant insert, select on port_contract.probe to ${dbRoles.app}`))
    await db.execute(sql`truncate port_contract.probe`)
  })
}

const probeCount = (port: DbPort) =>
  port.privileged(async (db) => {
    const [found] = await rows<{ count: number }>(
      db,
      sql`select count(*)::int as count from port_contract.probe`,
    )
    return found?.count
  })

async function within<T>(ms: number, what: string, work: Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${what} did not finish within ${ms} ms: a connection was not released`))
    }, ms)
  })
  try {
    return await Promise.race([work, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/** The Db Port contract. The subject may be a fresh database: each check migrates the core first. */
export const dbPortChecks: readonly Check<DbPort>[] = [
  {
    name: 'applies the role and every setting before the first statement',
    async run(port) {
      await migrate(port, [])
      const [settings] = await port.transaction(alice, (db) => rows<Settings>(db, readSettings))
      assert.deepEqual(
        { ...settings, statement_timeout: undefined },
        {
          role: dbRoles.app,
          user_id: 'alice',
          owner_id: 'team-a',
          source_id: 'laptop',
          statement_timeout: undefined,
        },
      )
    },
  },
  {
    name: 'runs readonly as a SELECT-only role with a 10 s statement timeout',
    async run(port) {
      await probe(port)
      const session: DbSession = { role: 'readonly', userId: 'alice', ownerId: 'alice' }
      const [settings] = await port.transaction(session, (db) => rows<Settings>(db, readSettings))
      assert.equal(settings?.role, dbRoles.readonly)
      assert.equal(settings.statement_timeout, '10s')
      await assert.rejects(
        port.transaction(session, (db) =>
          db.execute(sql`insert into port_contract.probe values ('readonly')`),
        ),
      )
      assert.equal(await probeCount(port), 0)
    },
  },
  {
    name: 'reads an absent Source as empty, never as the previous caller’s',
    async run(port) {
      await migrate(port, [])
      await port.transaction(alice, (db) => rows(db, readSettings))
      const [settings] = await port.transaction(
        { role: 'app', userId: 'bob', ownerId: 'bob' },
        (db) => rows<Settings>(db, readSettings),
      )
      assert.equal(settings?.source_id, '')
      assert.equal(settings.owner_id, 'bob')
    },
  },
  {
    name: 'leaves no role or setting behind for the next transaction',
    async run(port) {
      await migrate(port, [])
      await port.transaction(alice, (db) => rows(db, readSettings))
      const [settings] = await port.privileged((db) => rows<Settings>(db, readSettings))
      assert.notEqual(settings?.role, dbRoles.app)
      assert.ok(settings?.owner_id == null || settings.owner_id === '')
    },
  },
  {
    name: 'rolls back on a throw and rethrows the same error',
    async run(port) {
      await probe(port)
      const marker = new Marker('rollback')
      const caught = await port
        .transaction(alice, async (db) => {
          await db.execute(sql`insert into port_contract.probe values ('app')`)
          throw marker
        })
        .catch((error: unknown) => error)
      assert.equal(caught, marker)
      const privileged = await port
        .privileged(async (db) => {
          await db.execute(sql`insert into port_contract.probe values ('privileged')`)
          throw marker
        })
        .catch((error: unknown) => error)
      assert.equal(privileged, marker)
      assert.equal(await probeCount(port), 0)
    },
  },
  {
    name: 'releases its connection after every call, even on a throw',
    async run(port) {
      await migrate(port, [])
      const many = async () => {
        for (let i = 0; i < 30; i += 1) {
          await port
            .transaction(alice, async (db) => {
              await db.execute(sql`select 1`)
              if (i % 2 === 0) throw new Marker('leak')
            })
            .catch((error: unknown) => {
              if (!(error instanceof Marker)) throw error
            })
        }
        await Promise.all(
          Array.from({ length: 5 }, () =>
            port.transaction(alice, (db) => db.execute(sql`select 1`)),
          ),
        )
      }
      await within(10_000, '35 transactions', many())
    },
  },
]

/** Requests an Edge Identity Adapter is checked against. */
export interface EdgeIdentityFixture {
  port: EdgeIdentityPort
  /** A request with no assertion. */
  absent: Request
  /** A request with a valid assertion, and the email it names. */
  valid?: { request: Request; email: string }
  /** Requests whose assertion must be refused with EdgeIdentityError. */
  invalid?: readonly Request[]
  /** Requests this Adapter must ignore (null), such as another edge's header. */
  ignored?: readonly Request[]
}

/** The Edge Identity Port contract: valid, absent and invalid assertions. */
export const edgeIdentityChecks: readonly Check<EdgeIdentityFixture>[] = [
  {
    name: 'returns null when no assertion is present',
    async run({ port, absent, ignored = [] }) {
      assert.equal(await port.verify(absent), null)
      for (const request of ignored) assert.equal(await port.verify(request), null)
    },
  },
  {
    name: 'returns the email of a valid assertion',
    async run({ port, valid }) {
      if (valid === undefined) return
      assert.deepEqual(await port.verify(valid.request), { email: valid.email })
    },
  },
  {
    name: 'throws EdgeIdentityError for an invalid assertion',
    async run({ port, invalid = [] }) {
      for (const request of invalid) {
        await assert.rejects(port.verify(request), EdgeIdentityError)
      }
    },
  },
]
