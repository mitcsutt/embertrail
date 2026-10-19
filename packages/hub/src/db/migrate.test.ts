import { sql } from 'drizzle-orm'
import { serial } from 'drizzle-orm/pg-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createHub } from '../hub/create-hub'
import { noEdgeIdentity } from '../identity/edge'
import { defineModule, moduleSchema } from '../module/define'
import type { Migration, Module } from '../module/define'
import { pgliteDb } from '../testing/pglite'
import type { ClosableDbPort } from '../testing/pglite'
import { rows } from './port'

const items = moduleSchema('alpha').ownedTable('items', { id: serial('id').primaryKey() })

function alpha(migrations: readonly Migration[], dependsOn?: string[]) {
  return defineModule({
    contract: 1,
    name: 'alpha',
    tables: { items },
    migrations,
    ops: {},
    ...(dependsOn === undefined ? {} : { dependsOn }),
  })
}

const init: Migration = { id: '0000_init', sql: 'create table items (id serial primary key)' }

describe('migrate and boot', () => {
  let db: ClosableDbPort

  beforeEach(() => {
    db = pgliteDb()
  })

  afterEach(async () => {
    await db.close()
  })

  const hubWith = (...modules: Module[]) =>
    createHub({ config: {}, ports: { db, edgeIdentity: noEdgeIdentity() }, modules })

  const query = <T>(text: string) => db.privileged((tx) => rows<T>(tx, sql.raw(text)))

  it('applies core then Module migrations once, and is idempotent', async () => {
    const hub = hubWith(alpha([init]))
    expect(await hub.migrate()).toEqual({
      applied: [
        { schema: 'core', id: '0000_roles' },
        { schema: 'core', id: '0001_identity' },
        { schema: 'alpha', id: '0000_init' },
      ],
    })
    expect(await hub.migrate()).toEqual({ applied: [] })
    await expect(hub.boot()).resolves.toBeUndefined()
  })

  it('adds owner_id, its default and row-level security to the Module’s tables', async () => {
    await hubWith(alpha([init])).migrate()
    const [table] = await query<{ rls: boolean; policies: number }>(
      `select c.relrowsecurity as rls, (select count(*)::int from pg_policies p
         where p.schemaname = 'alpha' and p.tablename = 'items') as policies
       from pg_class c where c.oid = 'alpha.items'::regclass`,
    )
    expect(table).toEqual({ rls: true, policies: 4 })
    const [column] = await query<{ nullable: string; fallback: string }>(
      `select is_nullable as nullable, column_default as fallback from information_schema.columns
       where table_schema = 'alpha' and table_name = 'items' and column_name = 'owner_id'`,
    )
    expect(column).toEqual({
      nullable: 'NO',
      fallback: "NULLIF(current_setting('embertrail.owner_id'::text, true), ''::text)",
    })
  })

  it('accepts drizzle-kit style SQL that already declares owner_id', async () => {
    const kit: Migration = {
      id: '0000_init',
      sql: `CREATE TABLE "alpha"."items" (
  "id" serial PRIMARY KEY NOT NULL,
  "owner_id" text DEFAULT nullif(current_setting('embertrail.owner_id', true), '') NOT NULL
);
--> statement-breakpoint
CREATE INDEX "items_owner_idx" ON "alpha"."items" USING btree ("owner_id");`,
    }
    await expect(hubWith(alpha([kit])).migrate()).resolves.toMatchObject({
      applied: [{ schema: 'core' }, { schema: 'core' }, { schema: 'alpha', id: '0000_init' }],
    })
  })

  it('marks Module views security_invoker so they keep row-level security', async () => {
    const view: Migration = { id: '0001_view', sql: 'create view recent as select * from items' }
    await hubWith(alpha([init, view])).migrate()
    const [found] = await query<{ options: string[] }>(
      `select reloptions as options from pg_class where oid = 'alpha.recent'::regclass`,
    )
    expect(found?.options).toEqual(['security_invoker=true'])
  })

  it('runs Modules in dependsOn order, whatever order they are listed in', async () => {
    const zeta = defineModule({
      contract: 1,
      name: 'zeta',
      tables: {},
      migrations: [
        { id: '0000_first', sql: 'create table if not exists core.order_probe (n int)' },
      ],
      ops: {},
    })
    const after: Migration = {
      id: '0000_init',
      sql: 'create table items (id serial primary key)\n--> statement-breakpoint\ninsert into core.order_probe values (1)',
    }
    const report = await hubWith(alpha([after], ['zeta']), zeta).migrate()
    expect(report.applied.map((a) => a.schema)).toEqual(['core', 'core', 'zeta', 'alpha'])
  })

  it('fails boot when migrations are behind', async () => {
    await hubWith(alpha([init])).migrate()
    const next: Migration = { id: '0001_more', sql: 'alter table items add column note text' }
    await expect(hubWith(alpha([init, next])).boot()).rejects.toThrow(
      'Module "alpha": migrations behind: 1 migration(s) not applied (0001_more); run embertrail migrate',
    )
  })

  it('fails boot on a database that was never migrated', async () => {
    await expect(hubWith(alpha([init])).boot()).rejects.toThrow(
      'Hub core: migrations behind: 2 migration(s) not applied (0000_roles, 0001_identity); run embertrail migrate',
    )
  })

  it('fails boot and migrate when the database is ahead of the Hub', async () => {
    const next: Migration = { id: '0001_more', sql: 'alter table items add column note text' }
    await hubWith(alpha([init, next])).migrate()
    const older = hubWith(alpha([init]))
    const message =
      'Module "alpha": migrations ahead: the database has migration 0001_more, which this Hub doesn\'t know; run a newer Hub'
    await expect(older.boot()).rejects.toThrow(message)
    await expect(older.migrate()).rejects.toThrow(message)
  })

  it('fails boot on a table not declared with ownedTable', async () => {
    await hubWith(alpha([init])).migrate()
    await query('create table alpha.stray (id int)')
    await expect(hubWith(alpha([init])).boot()).rejects.toThrow(
      'Module "alpha": undeclared table: alpha.stray is not declared with ownedTable, so it has no row-level security',
    )
  })

  it('fails migrate when a declared table is never created, and rolls everything back', async () => {
    await expect(hubWith(alpha([])).migrate()).rejects.toThrow(
      'Module "alpha": missing table: alpha.items is declared but no migration creates it',
    )
    const [journal] = await query<{ table: string | null }>(
      "select to_regclass('core.migrations')::text as table",
    )
    expect(journal?.table).toBeNull()
  })
})
