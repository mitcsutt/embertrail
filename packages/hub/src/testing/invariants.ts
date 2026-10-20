import assert from 'node:assert/strict'

import { sql } from 'drizzle-orm'

import type { Check } from '../contract/index'
import { rows } from '../db/port'
import { createHub } from '../hub/create-hub'
import { noEdgeIdentity } from '../identity/edge'
import type { Scope } from '../module/define'
import { HubBootError } from '../module/errors'
import { identityInvariantChecks } from './identity-checks'
import { ledger, tangle, untangled } from './ledger'
import { assertModuleContract } from './module-contract'
import type { ClosableDbPort } from './pglite'
import { testHub } from './test-hub'
import type { TestHub } from './test-hub'

/** Opens a fresh, empty database for one check. */
export type OpenDb = () => Promise<ClosableDbPort>

const write: Scope[] = ['ledger:read', 'ledger:write']

async function withLedger(open: OpenDb, fn: (t: TestHub) => Promise<void>) {
  const t = await testHub({ modules: [ledger], db: await open() })
  try {
    await fn(t)
  } finally {
    await t.close()
  }
}

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>
}

async function count(t: TestHub, table: 'entries' | 'readings', where = sql`true`) {
  const [found] = await t.sql<{ count: number }>(
    sql`select count(*)::int as count from ${sql.raw(`ledger.${table}`)} where ${where}`,
  )
  return found?.count
}

async function expectInternal(t: TestHub, response: Response) {
  assert.equal(response.status, 500)
  const body = await json(response)
  assert.equal(body.type, 'urn:embertrail:problem:internal')
  assert.equal(body.module, 'ledger')
  assert.equal(typeof body.request_id, 'string')
  assert.equal(t.errors.length > 0, true)
}

/**
 * The Module contract's invariants (#25) and core identity's row-level security (#29),
 * proven against a real database. Hub tests run them on PGLite; the Docker Platform's tests
 * run them on Postgres 17.
 */
export const hubInvariantChecks: readonly Check<OpenDb>[] = [
  {
    name: 'stamps the caller as Owner and ignores a caller-supplied owner_id',
    run: (open) =>
      withLedger(open, async (t) => {
        const alice = t.as('alice', write)
        const response = await alice.post('/api/v1/ledger/entries?owner_id=mallory', {
          note: 'mine',
          owner_id: 'mallory',
        })
        assert.equal(response.status, 200)
        assert.equal((await json(response)).ownerId, 'alice')
        assert.equal(await count(t, 'entries', sql`owner_id = 'mallory'`), 0)
      }),
  },
  {
    name: 'the database refuses a Module that writes another owner_id',
    run: (open) =>
      withLedger(open, async (t) => {
        const response = await t
          .as('alice', write)
          .post('/api/v1/ledger/forged-entries', { note: 'spoof', as: 'mallory' })
        await expectInternal(t, response)
        assert.equal(await count(t, 'entries'), 0)
      }),
  },
  {
    name: 'the database refuses a Module that hands a row to another Owner',
    run: (open) =>
      withLedger(open, async (t) => {
        const alice = t.as('alice', write)
        const { id } = await json(await alice.post('/api/v1/ledger/entries', { note: 'keep' }))
        const response = await alice.put(`/api/v1/ledger/entries/${String(id)}`, {
          to: 'mallory',
        })
        await expectInternal(t, response)
        assert.equal(await count(t, 'entries', sql`owner_id = 'alice'`), 1)
      }),
  },
  {
    name: 'stamps the Source, ignores a caller-supplied source_id, and refuses a forged one',
    run: (open) =>
      withLedger(open, async (t) => {
        const laptop = t.as('alice', write, { sourceId: 'laptop' })
        const response = await laptop.post('/api/v1/ledger/readings', {
          value: 1,
          source_id: 'desktop',
        })
        assert.equal(response.status, 200)
        assert.equal((await json(response)).sourceId, 'laptop')
        const forged = await laptop.post('/api/v1/ledger/forged-readings', {
          value: 2,
          from: 'desktop',
        })
        await expectInternal(t, forged)
        assert.equal(await count(t, 'readings', sql`source_id = 'desktop'`), 0)
      }),
  },
  {
    name: 'ingest needs a Token bound to a Source',
    run: (open) =>
      withLedger(open, async (t) => {
        const response = await t.as('alice', write).post('/api/v1/ledger/readings', { value: 1 })
        assert.equal(response.status, 403)
        assert.equal((await json(response)).type, 'urn:embertrail:problem:forbidden')
      }),
  },
  {
    name: 'reads see only the caller’s rows; a hidden row is 404',
    run: (open) =>
      withLedger(open, async (t) => {
        const { id } = await json(
          await t.as('alice', write).post('/api/v1/ledger/entries', { note: 'private' }),
        )
        const bob = t.as('bob', write)
        assert.deepEqual(await json(await bob.get('/api/v1/ledger/entries')), { entries: [] })
        const hidden = await bob.get(`/api/v1/ledger/entries/${String(id)}`)
        assert.equal(hidden.status, 404)
        assert.equal((await json(hidden)).type, 'urn:embertrail:problem:not-found')
      }),
  },
  {
    name: 'the readonly role reads under the same row-level security and cannot write',
    run: (open) =>
      withLedger(open, async (t) => {
        await t.as('alice', write).post('/api/v1/ledger/entries', { note: 'private' })
        const asBob = { role: 'readonly', userId: 'bob', ownerId: 'bob' } as const
        const [visible] = await t.db.transaction(asBob, (db) =>
          rows<{ count: number }>(db, sql`select count(*)::int as count from ledger.entries`),
        )
        assert.equal(visible?.count, 0)
        await assert.rejects(
          t.db.transaction(asBob, (db) =>
            db.execute(sql`insert into ledger.entries (note) values ('nope')`),
          ),
        )
      }),
  },
  {
    name: 'a throw rolls the whole op back and answers 500 naming the Module',
    run: (open) =>
      withLedger(open, async (t) => {
        const response = await t.as('alice', write).post('/api/v1/ledger/fail', { note: 'gone' })
        await expectInternal(t, response)
        assert.equal(await count(t, 'entries'), 0)
      }),
  },
  {
    name: 'output is parsed by its schema, so a raw row loses owner_id and source_id',
    run: (open) =>
      withLedger(open, async (t) => {
        const alice = t.as('alice', write, { sourceId: 'laptop' })
        const entry = await alice.post('/api/v1/ledger/bare-entries', { note: 'bare' })
        assert.equal(entry.status, 200)
        assert.deepEqual(Object.keys(await json(entry)).sort(), ['id', 'note'])
        const reading = await alice.post('/api/v1/ledger/bare-readings', { value: 3 })
        assert.equal(reading.status, 200)
        assert.deepEqual(Object.keys(await json(reading)).sort(), ['id', 'value'])
      }),
  },
  {
    name: 'output failing its schema rolls back and answers 500 naming the Module and op',
    run: (open) =>
      withLedger(open, async (t) => {
        const response = await t
          .as('alice', write)
          .post('/api/v1/ledger/bad-output', { note: 'gone' })
        assert.equal(response.status, 500)
        const body = await json(response)
        assert.equal(body.type, 'urn:embertrail:problem:internal')
        assert.equal(body.module, 'ledger')
        assert.equal(
          body.detail,
          'op "ledger.badOutputAfterWrite" returned output that fails its schema',
        )
        assert.equal(t.errors.length, 1)
        assert.ok((t.errors[0] as { issues?: unknown[] }).issues?.length)
        assert.equal(await count(t, 'entries'), 0)
      }),
  },
  {
    name: 'a HubError maps to its status and still rolls back',
    run: (open) =>
      withLedger(open, async (t) => {
        const response = await t
          .as('alice', write)
          .post('/api/v1/ledger/conflict', { note: 'gone' })
        assert.equal(response.status, 409)
        assert.equal(response.headers.get('content-type'), 'application/problem+json')
        assert.equal((await json(response)).detail, 'Already taken')
        assert.equal(await count(t, 'entries'), 0)
      }),
  },
  {
    name: 'a missing Scope is 403 and no Token is 401',
    run: (open) =>
      withLedger(open, async (t) => {
        const reader = t.as('alice', ['ledger:read'])
        const denied = await reader.post('/api/v1/ledger/entries', { note: 'x' })
        assert.equal(denied.status, 403)
        assert.equal((await json(denied)).detail, 'Needs Scope ledger:write')
        assert.equal((await t.anonymous.get('/api/v1/ledger/entries')).status, 401)
      }),
  },
  {
    name: 'input failing its schema is a 400 with field errors',
    run: (open) =>
      withLedger(open, async (t) => {
        const response = await t.as('alice', write).post('/api/v1/ledger/entries', { note: '' })
        assert.equal(response.status, 400)
        const body = await json(response)
        assert.equal(body.type, 'urn:embertrail:problem:validation')
        assert.deepEqual(
          (body.errors as { pointer: string }[]).map((e) => e.pointer),
          ['/note'],
        )
      }),
  },
  {
    name: 'op.raw keeps auth, Scopes, Source binding and stamping',
    run: (open) =>
      withLedger(open, async (t) => {
        const path = '/api/v1/ledger/raw-readings'
        const send = (client = t.anonymous) => client.fetch(path, { method: 'POST', body: '7' })
        assert.equal((await send()).status, 401)
        assert.equal(
          (await send(t.as('alice', ['ledger:read'], { sourceId: 'laptop' }))).status,
          403,
        )
        assert.equal((await send(t.as('alice', write))).status, 403)
        assert.equal((await send(t.as('alice', write, { sourceId: 'laptop' }))).status, 202)
        assert.equal(
          await count(t, 'readings', sql`owner_id = 'alice' and source_id = 'laptop'`),
          1,
        )
      }),
  },
  {
    name: 'migrate refuses a foreign key outside core and leaves the database unchanged',
    async run(open) {
      const db = await open()
      try {
        const hub = createHub({
          config: {},
          ports: { db, edgeIdentity: noEdgeIdentity() },
          modules: [ledger, tangle],
        })
        await assert.rejects(hub.migrate(), {
          name: 'HubBootError',
          message:
            'Module "tangle": foreign key outside core: constraint links_entry_id_fkey references ledger.entries; foreign keys may target core.* or the Module\'s own schema only',
        })
        const [schemas] = await db.privileged((tx) =>
          rows(
            tx,
            sql`select to_regnamespace('ledger')::text as ledger, to_regnamespace('tangle')::text as tangle`,
          ),
        )
        assert.deepEqual(schemas, { ledger: null, tangle: null })
      } finally {
        await db.close()
      }
    },
  },
  {
    name: 'boot fails when a foreign key outside core appears after migrate',
    async run(open) {
      const db = await open()
      try {
        const ports = { db, edgeIdentity: noEdgeIdentity() }
        const hub = createHub({ config: {}, ports, modules: [ledger, untangled] })
        await hub.migrate()
        await hub.boot()
        await db.privileged((tx) =>
          tx.execute(
            sql`alter table tangle.links add foreign key (entry_id) references ledger.entries (id)`,
          ),
        )
        // A restart boots a new Hub on the same database.
        const restarted = createHub({ config: {}, ports, modules: [ledger, untangled] })
        await assert.rejects(restarted.boot(), (error: unknown) => {
          assert.ok(error instanceof HubBootError)
          assert.equal(error.rule, 'foreign key outside core')
          return true
        })
        const response = await restarted.fetch(new Request('http://hub.test/api/v1/ledger/entries'))
        assert.equal(response.status, 500)
        assert.equal(((await response.json()) as { module: string }).module, 'core')
      } finally {
        await db.close()
      }
    },
  },
  {
    name: 'passes the Module contract suite',
    async run(open) {
      await assertModuleContract(ledger, {
        db: await open(),
        async seed(client) {
          await client.post('/api/v1/ledger/entries', { note: 'one' })
          await client.post('/api/v1/ledger/readings', { value: 1 })
        },
      })
    },
  },
  ...identityInvariantChecks,
]
