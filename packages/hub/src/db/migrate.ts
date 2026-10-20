import { sql } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'

import { identityMigration } from '../identity/tables'
import { ownedTableInfo } from '../module/define'
import type { Migration, Module } from '../module/define'
import { HubBootError } from '../module/errors'
import { dbRoles, rows } from './port'
import type { DbPort, ScopedDb } from './port'

/** One applied migration. */
export interface AppliedMigration {
  schema: string
  id: string
}

export interface MigrationReport {
  applied: AppliedMigration[]
}

const coreSubject = 'Hub core'

/** The core's own schema: the two roles every transaction switches to, then identity (#29). */
export const coreMigrations: readonly Migration[] = [
  {
    id: '0000_roles',
    sql: [
      // Roles are cluster-wide, so another database may have created them already.
      `do $$ begin create role ${dbRoles.app} nologin; exception when duplicate_object or unique_violation then null; end $$`,
      `do $$ begin create role ${dbRoles.readonly} nologin; exception when duplicate_object or unique_violation then null; end $$`,
      `grant ${dbRoles.app}, ${dbRoles.readonly} to current_user`,
    ].join('\n--> statement-breakpoint\n'),
  },
  identityMigration,
]

/** Quotes a Postgres identifier. */
export function ident(name: string) {
  return `"${name.replaceAll('"', '""')}"`
}

function statements(text: string) {
  return text
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s !== '')
}

async function run(db: ScopedDb, statement: string) {
  await db.execute(sql.raw(statement))
}

const setting = (name: string) => `nullif(current_setting('embertrail.${name}', true), '')`

/** The owned tables a Module declares, with their Postgres names. */
export function declaredTables(module: Module) {
  return Object.values(module.tables).map((table) => {
    const config = getTableConfig(table)
    return {
      table,
      name: config.name,
      schema: config.schema,
      columns: config.columns.map((c) => c.name),
      signal: ownedTableInfo(table)?.signal ?? false,
    }
  })
}

/**
 * Idempotent: the ownership columns' defaults, row-level security, owner and source
 * indexes, role grants, and `security_invoker` on views. Run after every migrate, so a
 * Module's SQL never mentions any of it.
 */
function policySync(module: Module, views: readonly string[]): string[] {
  const schema = ident(module.name)
  const owner = setting('owner_id')
  const out = [
    `grant usage on schema ${schema} to ${dbRoles.app}, ${dbRoles.readonly}`,
    `grant usage, select on all sequences in schema ${schema} to ${dbRoles.app}`,
  ]
  for (const { name, signal, columns: declared } of declaredTables(module)) {
    const t = `${schema}.${ident(name)}`
    // A table with an account_id column holds an Account's rows: Grants (#29) apply to it,
    // and a row may only name an Account of its own Owner.
    const account = declared.includes('account_id')
    const stamped = [
      `owner_id = ${owner}`,
      ...(signal ? [`source_id = ${setting('source_id')}`] : []),
      ...(account ? ['(account_id is null or core.account_owner(account_id) = owner_id)'] : []),
    ].join(' and ')
    const readable = [
      // The caller's User, the Owner they act for, and their Teams (core.readable_owners).
      // Cast, so `any` takes the array; the subquery is uncorrelated, so it runs once.
      'owner_id = any ((select core.readable_owners())::text[])',
      ...(account
        ? [`account_id = any ((select core.granted_accounts('${module.name}'))::text[])`]
        : []),
    ].join(' or ')
    const columns = signal ? ['owner_id', 'source_id'] : ['owner_id']
    for (const column of columns) {
      out.push(
        `alter table ${t} add column if not exists ${column} text`,
        `alter table ${t} alter column ${column} set default ${setting(column)}, alter column ${column} set not null`,
        `create index if not exists ${ident(`${name}_${column}_idx`)} on ${t} (${column})`,
      )
    }
    if (account) {
      out.push(`create index if not exists ${ident(`${name}_account_id_idx`)} on ${t} (account_id)`)
    }
    out.push(
      `alter table ${t} enable row level security`,
      // Reads: the caller's own rows, their Teams' rows, and rows a Grant lets them read.
      `drop policy if exists embertrail_read on ${t}`,
      `create policy embertrail_read on ${t} for select to ${dbRoles.app}, ${dbRoles.readonly} using (${readable})`,
      // Writes: only the caller's Owner (and Source), whatever the Module's SQL says.
      `drop policy if exists embertrail_insert on ${t}`,
      `create policy embertrail_insert on ${t} for insert to ${dbRoles.app} with check (${stamped})`,
      `drop policy if exists embertrail_update on ${t}`,
      `create policy embertrail_update on ${t} for update to ${dbRoles.app} using (owner_id = ${owner}) with check (${stamped})`,
      `drop policy if exists embertrail_delete on ${t}`,
      `create policy embertrail_delete on ${t} for delete to ${dbRoles.app} using (owner_id = ${owner})`,
      `grant select, insert, update, delete on ${t} to ${dbRoles.app}`,
      `grant select on ${t} to ${dbRoles.readonly}`,
    )
  }
  for (const view of views) {
    const v = `${schema}.${ident(view)}`
    out.push(
      `alter view ${v} set (security_invoker = true)`,
      `grant select on ${v} to ${dbRoles.app}, ${dbRoles.readonly}`,
    )
  }
  return out
}

interface Relation {
  schema: string
  name: string
  kind: string
}

async function relations(db: ScopedDb, schemas: readonly string[]) {
  if (schemas.length === 0) return []
  return rows<Relation>(
    db,
    sql`select n.nspname as schema, c.relname as name, c.relkind as kind
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p', 'v') and n.nspname in ${schemas}`,
  )
}

/** Every table in a Module's schema is declared with `ownedTable`, and every declared one exists. */
function checkTables(found: readonly Relation[], modules: readonly Module[]) {
  for (const module of modules) {
    const declared = new Set(declaredTables(module).map((t) => t.name))
    const tables = found.filter((r) => r.schema === module.name && r.kind !== 'v')
    const undeclared = tables.find((r) => !declared.has(r.name))
    if (undeclared !== undefined) {
      throw new HubBootError(
        `Module "${module.name}"`,
        'undeclared table',
        `${module.name}.${undeclared.name} is not declared with ownedTable, so it has no row-level security`,
      )
    }
    const existing = new Set(tables.map((r) => r.name))
    const missing = [...declared].find((name) => !existing.has(name))
    if (missing !== undefined) {
      throw new HubBootError(
        `Module "${module.name}"`,
        'missing table',
        `${module.name}.${missing} is declared but no migration creates it`,
      )
    }
  }
}

/** Schema isolation (#25 invariant 4): foreign keys may target `core.*` or the Module's own schema. */
async function checkForeignKeys(db: ScopedDb, schemas: readonly string[]) {
  if (schemas.length === 0) return
  const [fk] = await rows<{ schema: string; name: string; target: string }>(
    db,
    sql`select n.nspname as schema, c.conname as name, tn.nspname || '.' || t.relname as target
      from pg_constraint c
      join pg_class r on r.oid = c.conrelid join pg_namespace n on n.oid = r.relnamespace
      join pg_class t on t.oid = c.confrelid join pg_namespace tn on tn.oid = t.relnamespace
      where c.contype = 'f' and n.nspname in ${schemas}
        and tn.nspname <> n.nspname and tn.nspname <> 'core'`,
  )
  if (fk !== undefined) {
    throw new HubBootError(
      `Module "${fk.schema}"`,
      'foreign key outside core',
      `constraint ${fk.name} references ${fk.target}; foreign keys may target core.* or the Module's own schema only`,
    )
  }
}

interface Source {
  subject: string
  schema: string
  migrations: readonly Migration[]
}

function sources(modules: readonly Module[]): Source[] {
  return [
    { subject: coreSubject, schema: 'core', migrations: coreMigrations },
    ...modules.map((m) => ({
      subject: `Module "${m.name}"`,
      schema: m.name,
      migrations: m.migrations,
    })),
  ]
}

async function journal(db: ScopedDb) {
  const [exists] = await rows<{ table: string | null }>(
    db,
    sql`select to_regclass('core.migrations')::text as table`,
  )
  if (exists?.table == null) return []
  return rows<AppliedMigration>(db, sql`select schema, id from core.migrations`)
}

/** Refuses a database that has migrations this Hub doesn't know: it is older than the data. */
function checkAhead(applied: readonly AppliedMigration[], all: readonly Source[]) {
  for (const source of all) {
    const known = new Set(source.migrations.map((m) => m.id))
    const unknown = applied.find((a) => a.schema === source.schema && !known.has(a.id))
    if (unknown !== undefined) {
      throw new HubBootError(
        source.subject,
        'migrations ahead',
        `the database has migration ${unknown.id}, which this Hub doesn't know; run a newer Hub`,
      )
    }
  }
}

/**
 * `embertrail migrate`: core migrations, then each Module in the given (dependency) order,
 * then the policy sync and isolation checks. One transaction: any failure leaves the
 * database as it was.
 */
export async function migrate(db: DbPort, modules: readonly Module[]): Promise<MigrationReport> {
  return db.privileged(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('embertrail.migrate'))`)
    await run(tx, 'create schema if not exists core')
    await run(
      tx,
      `create table if not exists core.migrations (
        schema text not null,
        id text not null,
        applied_at timestamptz not null default now(),
        primary key (schema, id)
      )`,
    )
    const all = sources(modules)
    const before = await journal(tx)
    checkAhead(before, all)
    const done = new Set(before.map((a) => `${a.schema}/${a.id}`))
    const applied: AppliedMigration[] = []
    for (const source of all) {
      await run(tx, `create schema if not exists ${ident(source.schema)}`)
      // Unqualified names in a Module's SQL land in its own schema.
      await run(tx, `set local search_path to ${ident(source.schema)}`)
      for (const migration of source.migrations) {
        if (done.has(`${source.schema}/${migration.id}`)) continue
        for (const statement of statements(migration.sql)) await run(tx, statement)
        await tx.execute(
          sql`insert into core.migrations (schema, id) values (${source.schema}, ${migration.id})`,
        )
        applied.push({ schema: source.schema, id: migration.id })
      }
    }
    await run(tx, 'set local search_path to default')
    const schemas = modules.map((m) => m.name)
    await checkForeignKeys(tx, schemas)
    const found = await relations(tx, schemas)
    checkTables(found, modules)
    for (const module of modules) {
      const views = found.filter((r) => r.schema === module.name && r.kind === 'v')
      for (const statement of policySync(
        module,
        views.map((v) => v.name),
      )) {
        await run(tx, statement)
      }
    }
    return { applied }
  })
}

/** Boot's database checks: every migration applied, none unknown, schemas isolated. */
export async function checkDatabase(db: DbPort, modules: readonly Module[]): Promise<void> {
  await db.privileged(async (tx) => {
    const all = sources(modules)
    const applied = await journal(tx)
    checkAhead(applied, all)
    const done = new Set(applied.map((a) => `${a.schema}/${a.id}`))
    for (const source of all) {
      const pending = source.migrations.filter((m) => !done.has(`${source.schema}/${m.id}`))
      if (pending.length > 0) {
        throw new HubBootError(
          source.subject,
          'migrations behind',
          `${pending.length} migration(s) not applied (${pending.map((m) => m.id).join(', ')}); run embertrail migrate`,
        )
      }
    }
    const schemas = modules.map((m) => m.name)
    await checkForeignKeys(tx, schemas)
    checkTables(await relations(tx, schemas), modules)
  })
}
