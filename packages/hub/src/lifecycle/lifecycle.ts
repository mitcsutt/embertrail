import { sql } from 'drizzle-orm'

import { declaredTables, ident } from '../db/migrate'
import { rows } from '../db/port'
import type { DbPort, ScopedDb } from '../db/port'
import type { Caller, Exporter, Module } from '../module/define'
import { HubError } from '../module/errors'
import { moduleCtx } from '../hub/ops'

export interface LifecycleOptions {
  db: DbPort
  /** The checked Modules, in the order the Hub loads them. */
  modules: readonly Module[]
  clock: () => Date
  /** Retention sweeps rows older than this many days; unset keeps everything. */
  retentionDays?: number | undefined
  /** Receives an export's unexpected error, which also errors the stream. */
  onError: (error: unknown, context: { requestId: string; module: string }) => void
}

/** The data lifecycle (#80): retention, removal and export, over each Module's owned tables. */
export interface Lifecycle {
  /** Deletes rows older than `retentionDays` from each Module's `retention` column. */
  runRetention: () => Promise<{ deleted: number }>
  /**
   * Hard-deletes a `core` record with every Module row it owns (a User or Team) or sent (a
   * Source), on the given privileged transaction; the `core` foreign keys cascade to its
   * Tokens, Accounts, Grants and memberships. False when there is no such record.
   */
  remove: (tx: ScopedDb) => {
    user: (userId: string) => Promise<boolean>
    team: (teamId: string) => Promise<boolean>
    source: (sourceId: string) => Promise<boolean>
  }
  /**
   * One Module's data for one Owner, streamed as JSON Lines. The export reads in one
   * transaction, held until the stream ends, errors or is cancelled.
   */
  exportOwner: (module: string, ownerId: string, requestId?: string) => ReadableStream<Uint8Array>
}

const exportPage = 500
const day = 86_400_000

const tableOf = (module: Module, table: string) => sql.raw(`${ident(module.name)}.${ident(table)}`)

/** Deletes the rows each Module's tables hold for `value`, counting them. */
async function deleteRows(
  tx: ScopedDb,
  modules: readonly Module[],
  column: 'owner_id' | 'source_id',
  value: string,
) {
  let deleted = 0
  for (const module of modules) {
    for (const table of declaredTables(module)) {
      if (column === 'source_id' && !table.signal) continue
      const [count] = await rows<{ count: number }>(
        tx,
        sql`with d as (delete from ${tableOf(module, table.name)}
          where ${sql.raw(column)} = ${value} returning 1) select count(*)::int as count from d`,
      )
      deleted += count?.count ?? 0
    }
  }
  return deleted
}

/** JSON Lines of every row the Owner owns, one `{ table, row }` object per line. */
function defaultExporter(module: Module): Exporter {
  return async function* exportRows(ctx) {
    for (const { name } of declaredTables(module)) {
      const table = tableOf(module, name)
      let after: string | undefined
      for (;;) {
        const found = await rows<{ row: unknown; cursor: string }>(
          ctx.db,
          sql`select row_to_json(t) as row, t.ctid::text as cursor from ${table} t
            where owner_id = ${ctx.caller.ownerId}
              ${after === undefined ? sql`` : sql`and t.ctid > ${after}::tid`}
            order by t.ctid limit ${exportPage}`,
        )
        for (const { row } of found) yield JSON.stringify({ table: name, row })
        if (found.length < exportPage) break
        after = found[found.length - 1]?.cursor
      }
    }
  }
}

export function lifecycle(options: LifecycleOptions): Lifecycle {
  const { db, modules, clock, onError } = options

  const removeRecord =
    (tx: ScopedDb, table: 'users' | 'teams' | 'sources', column: 'owner_id' | 'source_id') =>
    async (id: string) => {
      const [found] = await rows(
        tx,
        sql`select 1 from ${sql.raw(`core.${table}`)} where id = ${id} for update`,
      )
      if (found === undefined) return false
      await deleteRows(tx, modules, column, id)
      await tx.execute(sql`delete from ${sql.raw(`core.${table}`)} where id = ${id}`)
      return true
    }

  function exportOwner(
    name: string,
    ownerId: string,
    requestId: string = crypto.randomUUID(),
  ): ReadableStream<Uint8Array> {
    const module = modules.find((m) => m.name === name)
    if (module === undefined) throw HubError.notFound(`No Module "${name}"`)
    const caller: Caller = { userId: ownerId, ownerId, scopes: [] }
    const exporter = module.export ?? defaultExporter(module)
    const now = clock()
    const encoder = new TextEncoder()
    let cancelled = false
    let pulled: () => void
    let demand = new Promise<void>((resolve) => {
      pulled = resolve
    })
    let finished: Promise<void> | undefined
    return new ReadableStream<Uint8Array>(
      {
        start(controller) {
          finished = db
            .transaction({ role: 'app', userId: ownerId, ownerId }, async (scoped) => {
              for await (const line of exporter(moduleCtx(scoped, caller, now))) {
                await demand
                if (cancelled) return
                demand = new Promise((resolve) => {
                  pulled = resolve
                })
                controller.enqueue(encoder.encode(`${line}\n`))
              }
              if (!cancelled) controller.close()
            })
            .catch((error: unknown) => {
              onError(error, { requestId, module: name })
              controller.error(error)
            })
        },
        pull() {
          pulled()
        },
        cancel() {
          cancelled = true
          pulled()
          return finished
        },
      },
      { highWaterMark: 0 },
    )
  }

  return {
    async runRetention() {
      const days = options.retentionDays
      if (days === undefined) return { deleted: 0 }
      const cutoff = new Date(clock().getTime() - days * day).toISOString()
      return db.privileged(async (tx) => {
        let deleted = 0
        for (const module of modules) {
          const column = module.retention?.column
          if (column === undefined) continue
          for (const table of declaredTables(module)) {
            if (!table.columns.includes(column)) continue
            const [count] = await rows<{ count: number }>(
              tx,
              sql`with d as (delete from ${tableOf(module, table.name)}
                where ${sql.raw(ident(column))} < ${cutoff}::timestamptz returning 1)
                select count(*)::int as count from d`,
            )
            deleted += count?.count ?? 0
          }
        }
        return { deleted }
      })
    },

    remove: (tx) => ({
      user: removeRecord(tx, 'users', 'owner_id'),
      team: removeRecord(tx, 'teams', 'owner_id'),
      source: removeRecord(tx, 'sources', 'source_id'),
    }),

    exportOwner,
  }
}
