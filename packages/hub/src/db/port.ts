import { sql } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'

/** Drizzle on one transaction. What a Module's ops see as `ctx.db`. */
export type ScopedDb = PgDatabase<PgQueryResultHKT>

/** Who a transaction runs as. Row-level security reads these settings. */
export interface DbSession {
  /** `readonly` is the `/api/v1/sql` role: SELECT only. */
  role: 'app' | 'readonly'
  userId: string
  ownerId: string
  sourceId?: string | undefined
  /** `readonly` defaults to 10 000 ms; `app` keeps the server's setting. */
  statementTimeoutMs?: number | undefined
}

/**
 * The Db Port (#26). Each Platform supplies an Adapter; the core never imports a driver.
 *
 * - `transaction` applies the role and the `embertrail.*` settings before `fn` runs, inside
 *   the same transaction, so row-level security is always active.
 * - One connection per call, released in `finally`. A thrown error rolls back and is
 *   rethrown unchanged.
 */
export interface DbPort {
  transaction<T>(session: DbSession, fn: (db: ScopedDb) => Promise<T>): Promise<T>
  /**
   * Runs `fn` in one transaction as the connecting role, with no session settings and so
   * outside row-level security. Only the core uses it: migrations, policy sync, boot checks,
   * retention and deletes. Modules never see it.
   */
  privileged<T>(fn: (db: ScopedDb) => Promise<T>): Promise<T>
}

/** Postgres roles every transaction switches to. Created by the core's migrations. */
export const dbRoles = { app: 'embertrail_app', readonly: 'embertrail_readonly' } as const

const readonlyStatementTimeoutMs = 10_000

/** Applies a session's role and settings as the transaction's first statement. */
export async function applySession(db: ScopedDb, session: DbSession): Promise<void> {
  const timeout =
    session.statementTimeoutMs ??
    (session.role === 'readonly' ? readonlyStatementTimeoutMs : undefined)
  const setTimeout =
    timeout === undefined ? sql`` : sql`, set_config('statement_timeout', ${String(timeout)}, true)`
  // set_config(..., true) is SET LOCAL: it ends with the transaction, so a pooled connection
  // never carries one request's identity into the next. An absent Source is '', which the
  // policies read as NULL.
  await db.execute(sql`select
    set_config('role', ${dbRoles[session.role]}, true),
    set_config('embertrail.user_id', ${session.userId}, true),
    set_config('embertrail.owner_id', ${session.ownerId}, true),
    set_config('embertrail.source_id', ${session.sourceId ?? ''}, true)${setTimeout}`)
}

/**
 * Builds a Db Port from any Drizzle Postgres database whose `transaction` holds one
 * connection for the whole call (a node-postgres Pool or Client, PGLite). Adapters wrap it
 * with their own connection handling.
 */
export function drizzleDbPort(db: ScopedDb): DbPort {
  return {
    transaction: (session, fn) =>
      db.transaction(async (tx) => {
        await applySession(tx, session)
        return fn(tx)
      }),
    privileged: (fn) => db.transaction((tx) => fn(tx)),
  }
}

/** Runs raw SQL and returns its rows, whichever driver is underneath. */
export async function rows<T>(db: ScopedDb, query: Parameters<ScopedDb['execute']>[0]) {
  const result: unknown = await db.execute(query)
  return (result as { rows: T[] }).rows
}
