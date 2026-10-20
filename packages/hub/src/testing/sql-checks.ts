import assert from 'node:assert/strict'

import { sql } from 'drizzle-orm'
import { bigint, jsonb, numeric, serial, text, timestamp } from 'drizzle-orm/pg-core'

import type { Check } from '../contract/index'
import { defineModule, moduleSchema } from '../index'
import type { OpenDb } from './invariants'
import { testHub } from './test-hub'
import type { TestClient, TestHub } from './test-hub'

// A fixture Module for the SQL endpoint (#34): one owned table and a view over it, seeded
// outside row-level security so each check controls exactly whose rows exist.

const schema = moduleSchema('sqlcheck')

const items = schema.ownedTable('items', {
  id: serial('id').primaryKey(),
  note: text('note').notNull(),
  amount: numeric('amount'),
  big: bigint('big', { mode: 'bigint' }),
  at: timestamp('at', { withTimezone: true }),
  meta: jsonb('meta'),
})

const sqlcheck = defineModule({
  contract: 1,
  name: 'sqlcheck',
  tables: { items },
  // owner_id is declared only so the view can name it; the policy sync sets its default.
  migrations: [
    {
      id: '0000_init',
      sql: `create table items (id serial primary key, note text not null, amount numeric, big bigint, at timestamptz, meta jsonb, owner_id text)
--> statement-breakpoint
create view item_notes as select id, note, owner_id from items`,
    },
  ],
  ops: {},
})

async function withHub(open: OpenDb, fn: (t: TestHub) => Promise<void>) {
  const t = await testHub({ modules: [sqlcheck], db: await open() })
  try {
    await t.sql(sql`insert into sqlcheck.items (note, amount, big, at, meta, owner_id) values
      ('alice-1', 12.50, 9007199254740993, '2026-10-01T09:30:00.123456+02:00', '{"tool":"Bash","n":1}', 'alice'),
      ('alice-2', null, null, null, null, 'alice'),
      ('bob-1', 99, 1, '2026-10-02T00:00:00Z', '{"secret":true}', 'bob'),
      ('crew-1', 7, 2, null, null, 'crew')`)
    await fn(t)
  } finally {
    await t.close()
  }
}

interface SqlBody {
  columns?: { name: string; type: string }[]
  rows?: unknown[][]
  truncated?: boolean
  type?: string
  sqlstate?: string
  detail?: string
}

async function query(client: TestClient, statement: string, params?: unknown[]) {
  const response = await client.post('/api/v1/sql', {
    sql: statement,
    ...(params === undefined ? {} : { params }),
  })
  return { status: response.status, body: (await response.json()) as SqlBody }
}

async function ok(client: TestClient, statement: string, params?: unknown[]) {
  const { status, body } = await query(client, statement, params)
  assert.equal(status, 200, `${statement}: ${JSON.stringify(body)}`)
  return body
}

async function refused(client: TestClient, statement: string, slug = 'sql-error') {
  const { status, body } = await query(client, statement)
  assert.equal(status, 422, `${statement} answered ${String(status)}: ${JSON.stringify(body)}`)
  assert.equal(body.type, `urn:embertrail:problem:${slug}`, statement)
  if (slug === 'sql-error') assert.match(body.sqlstate ?? '', /^[0-9A-Z]{5}$/, statement)
  return body
}

const allNotes = 'select note from sqlcheck.items order by note'

/** Statements the endpoint must refuse, each a different way out of a read-only session. */
const escapes = [
  "insert into sqlcheck.items (note) values ('x')",
  "update sqlcheck.items set note = 'x'",
  'delete from sqlcheck.items',
  'with gone as (delete from sqlcheck.items returning 1) select * from gone',
  'truncate sqlcheck.items',
  'create table sqlcheck.extra (id int)',
  'drop view sqlcheck.item_notes',
  'grant select on sqlcheck.items to public',
  'set role postgres',
  'reset role',
  'set statement_timeout = 0',
  "select set_config('role', 'none', true)",
  "select set_config('statement_timeout', '0', true)",
  "select pg_catalog.set_config('embertrail.user_id', 'bob', true)",
  "select set_config('embertrail.owner_id', 'bob', true), query_to_xml('select note from sqlcheck.items', true, false, '')",
  'select pg_advisory_lock(1)',
  'select lo_create(0)',
  'select 1; select 2',
  'select 1; delete from sqlcheck.items',
  "do $$ begin perform set_config('role', 'none', true); end $$",
  'copy sqlcheck.items to stdout',
]

/**
 * The read-only SQL endpoint's guarantees (#34), proven against a real database. The Hub's
 * tests run them on PGLite; the Docker Platform's tests run them on Postgres 17.
 */
export const sqlEndpointChecks: readonly Check<OpenDb>[] = [
  {
    name: 'returns columns, rows and types as the spec serialises them',
    run: (open) =>
      withHub(open, async (t) => {
        const alice = t.as('alice', ['sql:read'])
        const body = await ok(
          alice,
          `select note, amount, big, at, meta, 1::int4 as one, array[1, 2]::int8[] as ids, true as yes
           from sqlcheck.items where note = $1`,
          ['alice-1'],
        )
        assert.deepEqual(body.columns, [
          { name: 'note', type: 'text' },
          { name: 'amount', type: 'numeric' },
          { name: 'big', type: 'int8' },
          { name: 'at', type: 'timestamptz' },
          { name: 'meta', type: 'jsonb' },
          { name: 'one', type: 'int4' },
          { name: 'ids', type: 'int8[]' },
          { name: 'yes', type: 'bool' },
        ])
        assert.deepEqual(body.rows, [
          [
            'alice-1',
            '12.50',
            '9007199254740993',
            '2026-10-01T07:30:00.123456Z',
            { tool: 'Bash', n: 1 },
            1,
            ['1', '2'],
            true,
          ],
        ])
        assert.equal(body.truncated, false)
        const nulls = await ok(
          alice,
          "select amount, at, meta from sqlcheck.items where note = 'alice-2';",
        )
        assert.deepEqual(nulls.rows, [[null, null, null]])
        const typed = await ok(
          alice,
          'select $1::int + $2::int as sum, $3::bool as flag, $4::text as gap',
          [2, 3, false, null],
        )
        assert.deepEqual(typed.rows, [[5, false, null]])
      }),
  },
  {
    name: 'returns at most 10,000 rows and says when it truncated',
    run: (open) =>
      withHub(open, async (t) => {
        const alice = t.as('alice', ['sql:read'])
        const over = await ok(alice, 'select n from generate_series(1, 10001) as n')
        assert.equal(over.rows?.length, 10_000)
        assert.deepEqual(over.rows.at(-1), [10_000])
        assert.equal(over.truncated, true)
        const exact = await ok(alice, 'select n from generate_series(1, 10000) as n')
        assert.equal(exact.rows?.length, 10_000)
        assert.equal(exact.truncated, false)
      }),
  },
  {
    name: 'refuses writes, DDL, role and setting changes, and multiple statements',
    run: (open) =>
      withHub(open, async (t) => {
        const alice = t.as('alice', ['sql:read'])
        for (const statement of escapes) await refused(alice, statement)
        // Closing the subquery the endpoint wraps it in: the extended protocol refuses the rest.
        const breakout = await refused(
          alice,
          'select 1) as x; delete from sqlcheck.items; select * from (select 1',
        )
        assert.match(breakout.detail ?? '', /multiple commands/)
        const notes = await t.sql<{ note: string }>(allNotes)
        assert.deepEqual(
          notes.map((r) => r.note),
          ['alice-1', 'alice-2', 'bob-1', 'crew-1'],
        )
        const [locks] = await t.sql<{ count: number }>(
          "select count(*)::int as count from pg_locks where locktype = 'advisory'",
        )
        assert.equal(locks?.count, 0)
        // The session is intact afterwards: still alice, still read-only.
        const after = await ok(alice, allNotes)
        assert.deepEqual(after.rows, [['alice-1'], ['alice-2']])
      }),
  },
  {
    name: 'hides another User’s rows through tables and views',
    run: (open) =>
      withHub(open, async (t) => {
        const alice = t.as('alice', ['sql:read'])
        const bob = t.as('bob', ['sql:read'])
        assert.deepEqual((await ok(alice, allNotes)).rows, [['alice-1'], ['alice-2']])
        assert.deepEqual((await ok(bob, allNotes)).rows, [['bob-1']])
        const view = 'select note, owner_id from sqlcheck.item_notes order by note'
        assert.deepEqual((await ok(alice, view)).rows, [
          ['alice-1', 'alice'],
          ['alice-2', 'alice'],
        ])
        assert.deepEqual((await ok(bob, view)).rows, [['bob-1', 'bob']])
        const asked = await ok(alice, "select count(*) from sqlcheck.items where owner_id = 'bob'")
        assert.deepEqual(asked.rows, [['0']])
        // A Team's rows are readable by its members, as through any other endpoint.
        await t.team('crew', { members: ['alice'] })
        assert.deepEqual((await ok(alice, allNotes)).rows, [['alice-1'], ['alice-2'], ['crew-1']])
        assert.deepEqual((await ok(bob, allNotes)).rows, [['bob-1']])
        // The core tables stay out of reach.
        await refused(alice, 'select id from core.tokens')
      }),
  },
  {
    name: 'requires the sql:read Scope and a valid body',
    run: (open) =>
      withHub(open, async (t) => {
        const anonymous = await query(t.anonymous, 'select 1')
        assert.equal(anonymous.status, 401)
        const reader = t.as('alice', ['self:manage'])
        const forbidden = await query(reader, 'select 1')
        assert.equal(forbidden.status, 403)
        assert.equal(forbidden.body.type, 'urn:embertrail:problem:forbidden')
        const alice = t.as('carol', ['sql:read'])
        for (const body of [
          {},
          { sql: '' },
          { sql: 'select 1', extra: true },
          { sql: 'select 1', params: [{}] },
        ]) {
          const response = await alice.post('/api/v1/sql', body)
          assert.equal(response.status, 400, JSON.stringify(body))
        }
      }),
  },
]

/**
 * The 10 s statement timeout. Postgres only: PGLite runs in one thread and never fires
 * `statement_timeout`, so this check would just sleep there.
 */
export const sqlTimeoutChecks: readonly Check<OpenDb>[] = [
  {
    name: 'stops a statement after 10 s with query-timeout',
    run: (open) =>
      withHub(open, async (t) => {
        const alice = t.as('alice', ['sql:read'])
        await refused(alice, 'select pg_sleep(11)', 'query-timeout')
      }),
  },
]
