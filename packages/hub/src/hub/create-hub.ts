import { sql } from 'drizzle-orm'

import type { CoreCtx } from '../admin/core-op'
import { checkDatabase, declaredTables, ident, migrate } from '../db/migrate'
import type { MigrationReport } from '../db/migrate'
import { rows } from '../db/port'
import type { DbPort, ScopedDb } from '../db/port'
import { coreDirectory } from '../identity/directory'
import type { Directory } from '../identity/directory'
import type { EdgeIdentityPort } from '../identity/edge'
import { coreScopes } from '../module/define'
import type { Caller, Exporter, Module, Scope } from '../module/define'
import { HubError } from '../module/errors'
import { checkModules, checkPaths, parseConfig } from './boot'
import type { HubConfig } from './boot'
import { knownError, OutputError, problem } from './http'
import { buildOpenApi } from './openapi'
import type { OpenApiDocument } from './openapi'
import { hubOps, moduleCtx } from './ops'
import { pipeline } from './pipeline'
import type { HubOp, Services } from './pipeline'
import { Router } from './router'

/** The Ports the core needs from a Platform (#26). */
export interface Ports {
  db: DbPort
  edgeIdentity: EdgeIdentityPort
}

export interface HubOptions {
  /** Built by the Platform's entry file; validated here. The core never reads env itself. */
  config: HubConfig
  ports: Ports
  modules: readonly Module[]
  /** The clock behind `ctx.now()` and retention. */
  clock?: () => Date
  /** Receives every unexpected error (each one a 500). Default: `console.error`. */
  onError?: (error: unknown, context: { requestId: string; module: string }) => void
}

export interface Hub {
  /** Serves the Hub's HTTP API. Checks the database once, before the first op that reaches it. */
  fetch(request: Request): Promise<Response>
  /** `embertrail migrate`: core, then each Module in dependency order, then the policy sync. */
  migrate(): Promise<MigrationReport>
  /** Fails unless every migration is applied and every Module's schema is isolated. */
  boot(): Promise<void>
  /** Deletes rows older than `retentionDays` from each Module's `retention` column. */
  runRetention(): Promise<{ deleted: number }>
  /** Hard-deletes a Source's rows in every Module. Returns the rows deleted. */
  deleteBySource(sourceId: string): Promise<number>
  /** Hard-deletes an Owner's rows in every Module. Returns the rows deleted. */
  deleteByOwner(ownerId: string): Promise<number>
  /**
   * One Module's data for one Owner, streamed as JSON Lines. The export reads in one
   * transaction, held until the stream ends, errors or is cancelled.
   */
  exportOwner(module: string, ownerId: string): ReadableStream<Uint8Array>
  readonly openapi: OpenApiDocument
  /** Every Scope a Token may hold: the loaded Modules' and the core's (`admin`, `self:manage`, `sql:read`). */
  readonly scopes: readonly Scope[]
  /** Users, Teams, Sources, Tokens, Accounts and Grants (#29), unchecked as to who asks. */
  readonly directory: Directory
}

const exportPage = 500

/** JSON Lines of every row the Owner owns, one `{ table, row }` object per line. */
function defaultExporter(module: Module): Exporter {
  return async function* exportRows(ctx) {
    for (const { name } of declaredTables(module)) {
      const table = sql.raw(`${ident(module.name)}.${ident(name)}`)
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

/**
 * `Hub.migrate` without a Hub: the same Module checks and dependency order, needing only a Db
 * Port. Throws `HubBootError` when a Module breaks the contract.
 */
export function migrateModules(db: DbPort, modules: readonly Module[]): Promise<MigrationReport> {
  const ordered = checkModules(modules)
  checkPaths(hubOps(ordered))
  return migrate(db, ordered)
}

/**
 * Builds a Hub from a Platform's config and Ports and the Modules it loads. Throws
 * `HubBootError` when a Module breaks the contract; `boot()` adds the database's checks.
 */
export function createHub(options: HubOptions): Hub {
  return assembleHub(options)
}

/** `createHub`, also serving `extra` core ops: how a test registers a fixture core op. */
export function assembleHub(options: HubOptions, extra: readonly HubOp[] = []): Hub {
  const config = parseConfig(options.config)
  const modules = checkModules(options.modules)
  const ops = hubOps(modules, extra)
  checkPaths(ops)
  const openapi = buildOpenApi(ops)
  const { db, edgeIdentity } = options.ports
  const clock = options.clock ?? (() => new Date())
  const scopes = [...new Set<Scope>([...modules.flatMap((m) => m.scopes), ...coreScopes])]
  const directory = coreDirectory({
    db,
    scopes,
    modules: modules.map((m) => m.name),
    allowedEmails: config.allowedEmails,
    allowedDomains: config.allowedDomains,
    clock,
  })
  const onError =
    options.onError ??
    ((error, context) => {
      console.error(`[embertrail] ${context.requestId} in ${context.module}:`, error)
    })

  let booted: Promise<void> | undefined
  const boot = () => {
    booted ??= checkDatabase(db, modules).catch((error: unknown) => {
      booted = undefined
      throw error
    })
    return booted
  }

  async function deleteRows(tx: ScopedDb, column: 'owner_id' | 'source_id', value: string) {
    let deleted = 0
    for (const module of modules) {
      for (const table of declaredTables(module)) {
        if (column === 'source_id' && !table.signal) continue
        const [count] = await rows<{ count: number }>(
          tx,
          sql`with d as (delete from ${sql.raw(`${ident(module.name)}.${ident(table.name)}`)}
            where ${sql.raw(column)} = ${value} returning 1) select count(*)::int as count from d`,
        )
        deleted += count?.count ?? 0
      }
    }
    return deleted
  }

  const deleteWhere = (column: 'owner_id' | 'source_id', value: string) =>
    db.privileged((tx) => deleteRows(tx, column, value))

  /**
   * Hard-deletes a `core` record with every Module row it owns (a User or Team) or sent (a
   * Source), in one transaction; the `core` foreign keys cascade to its Tokens, Accounts,
   * Grants and memberships. False when there is no such record.
   */
  const removeRecord =
    (tx: ScopedDb, table: 'users' | 'teams' | 'sources', column: 'owner_id' | 'source_id') =>
    async (id: string) => {
      const [found] = await rows(
        tx,
        sql`select 1 from ${sql.raw(`core.${table}`)} where id = ${id} for update`,
      )
      if (found === undefined) return false
      await deleteRows(tx, column, id)
      await tx.execute(sql`delete from ${sql.raw(`core.${table}`)} where id = ${id}`)
      return true
    }
  const remove = (tx: ScopedDb): CoreCtx['remove'] => ({
    user: removeRecord(tx, 'users', 'owner_id'),
    team: removeRecord(tx, 'teams', 'owner_id'),
    source: removeRecord(tx, 'sources', 'source_id'),
  })

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

  const services: Services = {
    db,
    directory,
    scopes,
    modules: modules.map((m) => m.name),
    openapi,
    remove,
    exportOwner,
  }
  const { prepare } = pipeline({
    boot,
    db,
    edgeIdentity,
    resolver: directory,
    bootstrapToken: config.bootstrapToken,
    clock,
    services,
  })
  const router = new Router<HubOp>()
  for (const op of ops) router.add(op.method, op.path, op)

  return {
    openapi,
    scopes,
    directory,

    async fetch(request) {
      const requestId = crypto.randomUUID()
      let module = 'core'
      try {
        const url = new URL(request.url)
        const found = router.match(request.method, url.pathname)
        if (found === undefined) {
          throw HubError.notFound(`No route for ${request.method} ${url.pathname}`)
        }
        const run = await prepare(found.target, request, found.params, requestId)
        // From here on, an unexpected error is the op's Module's.
        module = found.target.module
        return await run()
      } catch (error) {
        const known = knownError(error)
        if (known !== undefined) return problem(known, requestId)
        onError(error, { requestId, module })
        const detail = error instanceof OutputError ? error.message : undefined
        return problem(new HubError(500, 'internal', detail), requestId, module)
      }
    },

    async migrate() {
      const report = await migrate(db, modules)
      booted = undefined
      return report
    },

    boot,

    async runRetention() {
      const days = config.retentionDays
      if (days === undefined) return { deleted: 0 }
      const cutoff = new Date(clock().getTime() - days * 86_400_000).toISOString()
      return db.privileged(async (tx) => {
        let deleted = 0
        for (const module of modules) {
          const column = module.retention?.column
          if (column === undefined) continue
          for (const table of declaredTables(module)) {
            if (!table.columns.includes(column)) continue
            const [count] = await rows<{ count: number }>(
              tx,
              sql`with d as (delete from ${sql.raw(`${ident(module.name)}.${ident(table.name)}`)}
                where ${sql.raw(ident(column))} < ${cutoff}::timestamptz returning 1)
                select count(*)::int as count from d`,
            )
            deleted += count?.count ?? 0
          }
        }
        return { deleted }
      })
    },

    deleteBySource: (sourceId) => deleteWhere('source_id', sourceId),
    deleteByOwner: (ownerId) => deleteWhere('owner_id', ownerId),

    exportOwner,
  }
}
