import { sql } from 'drizzle-orm'

import { checkDatabase, declaredTables, ident, migrate } from '../db/migrate'
import type { MigrationReport } from '../db/migrate'
import { rows } from '../db/port'
import type { DbPort, DbSession, ScopedDb } from '../db/port'
import type { EdgeIdentityPort } from '../identity/edge'
import { emptyDirectory, resolveCaller } from '../identity/resolve'
import type { Directory } from '../identity/resolve'
import { isReply, opScope } from '../module/define'
import type { Caller, Ctx, Exporter, Module, Op, OwnerRef, Scope } from '../module/define'
import { HubError } from '../module/errors'
import { checkModules, parseConfig } from './boot'
import type { HubConfig } from './boot'
import { knownError, OutputError, parseOutput, problem, readInput, validate } from './http'
import { buildOpenApi } from './openapi'
import type { OpenApiDocument } from './openapi'
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
  /** Where Users and Tokens are looked up. Until core identity (#29), the default knows nobody. */
  directory?: Directory
  /** The clock behind `ctx.now()` and retention. */
  clock?: () => Date
  /** Receives every unexpected error (each one a 500). Default: `console.error`. */
  onError?: (error: unknown, context: { requestId: string; module: string }) => void
}

export interface Hub {
  /** Serves the Hub's HTTP API. Checks the database once, before the first op. */
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
  /** One Module's data for one Owner, as JSON Lines. */
  exportOwner(module: string, ownerId: string): Promise<string>
  readonly openapi: OpenApiDocument
  /** Every Scope the loaded Modules derive, plus `admin`. */
  readonly scopes: readonly Scope[]
}

type Target =
  { kind: 'core'; respond: () => Response } | { kind: 'op'; module: Module; key: string; op: Op }

/** JSON Lines of every row the Owner owns, one `{ table, row }` object per line. */
function defaultExporter(module: Module): Exporter {
  return async function* exportRows(ctx) {
    for (const { name } of declaredTables(module)) {
      const found = await rows<{ row: unknown }>(
        ctx.db,
        sql`select row_to_json(t) as row from ${sql.raw(`${ident(module.name)}.${ident(name)}`)} t
          where owner_id = ${ctx.caller.ownerId}`,
      )
      for (const { row } of found) yield JSON.stringify({ table: name, row })
    }
  }
}

/**
 * Builds a Hub from a Platform's config and Ports and the Modules it loads. Throws
 * `HubBootError` when a Module breaks the contract; `boot()` adds the database's checks.
 */
export function createHub(options: HubOptions): Hub {
  const config = parseConfig(options.config)
  const modules = checkModules(options.modules)
  const openapi = buildOpenApi(modules)
  const { db, edgeIdentity } = options.ports
  const directory = options.directory ?? emptyDirectory
  const clock = options.clock ?? (() => new Date())
  const onError =
    options.onError ??
    ((error, context) => {
      console.error(`[embertrail] ${context.requestId} in ${context.module}:`, error)
    })
  const ownerOf = async (ownerId: string): Promise<OwnerRef> => ({
    kind: (await directory.ownerKind?.(ownerId)) ?? 'user',
    id: ownerId,
  })

  const router = new Router<Target>()
  router.add('GET', '/api/v1/openapi.json', { kind: 'core', respond: () => Response.json(openapi) })
  for (const module of modules) {
    for (const [key, op] of Object.entries(module.ops))
      router.add(op.method, op.path, { kind: 'op', module, key, op })
  }

  let booted: Promise<void> | undefined
  const boot = () => {
    booted ??= checkDatabase(db, modules).catch((error: unknown) => {
      booted = undefined
      throw error
    })
    return booted
  }

  /** Resolves the caller, checks the Scope and validates the input; returns the op's run. */
  async function prepare(
    request: Request,
    module: Module,
    key: string,
    op: Op,
    params: Record<string, string>,
  ) {
    const caller = await resolveCaller(request, edgeIdentity, directory)
    const scope = opScope(module.name, op)
    if (!caller.scopes.includes(scope)) throw HubError.forbidden(`Needs Scope ${scope}`)
    const sourceBound = op.kind === 'ingest' || (op.kind === 'raw' && op.sourceBound)
    if (sourceBound && caller.sourceId === undefined) {
      throw HubError.forbidden('Needs a Token bound to a Source')
    }
    const session: DbSession = {
      role: 'app',
      userId: caller.userId,
      ownerId: caller.ownerId,
      sourceId: caller.sourceId,
    }
    const now = clock()
    const ctx = (scoped: ScopedDb): Ctx => ({
      db: scoped,
      caller,
      now: () => new Date(now),
      ownerOf,
    })
    if (op.kind === 'raw') {
      return () => db.transaction(session, (scoped) => op.run(request, ctx(scoped)))
    }
    const input = await validate(op.input, await readInput(request, params, op.headers))
    const name = `${module.name}.${key}`
    return async () => {
      const { status, etag, body } = await db.transaction(session, async (scoped) => {
        const result = await op.run(input, ctx(scoped))
        const replied = isReply(result) ? result : { status: 200 as const, body: result }
        if (!op.statuses.includes(replied.status)) {
          throw new OutputError(name, [], `answered ${String(replied.status)}, not in its statuses`)
        }
        return {
          status: replied.status,
          etag: 'etag' in replied ? replied.etag : undefined,
          body: replied.status === 204 ? null : await parseOutput(op.output, replied.body, name),
        }
      })
      const headers = etag === undefined ? undefined : { etag }
      return status === 204
        ? new Response(null, { status, headers })
        : Response.json(body, { status, headers })
    }
  }

  async function deleteWhere(column: 'owner_id' | 'source_id', value: string) {
    return db.privileged(async (tx) => {
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
    })
  }

  return {
    openapi,
    scopes: [...new Set<Scope>([...modules.flatMap((m) => m.scopes), 'admin'])],

    async fetch(request) {
      const requestId = crypto.randomUUID()
      let module = 'core'
      try {
        const url = new URL(request.url)
        const found = router.match(request.method, url.pathname)
        if (found === undefined) {
          throw HubError.notFound(`No route for ${request.method} ${url.pathname}`)
        }
        const { target } = found
        if (target.kind === 'core') return target.respond()
        await boot()
        const run = await prepare(request, target.module, target.key, target.op, found.params)
        // From here on, an unexpected error is the Module's.
        module = target.module.name
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

    async exportOwner(name, ownerId) {
      const module = modules.find((m) => m.name === name)
      if (module === undefined) throw HubError.notFound(`No Module "${name}"`)
      const caller: Caller = { userId: ownerId, ownerId, scopes: [] }
      const exporter = module.export ?? defaultExporter(module)
      const now = clock()
      return db.transaction({ role: 'app', userId: ownerId, ownerId }, async (scoped) => {
        const lines: string[] = []
        for await (const line of exporter({
          db: scoped,
          caller,
          now: () => new Date(now),
          ownerOf,
        })) {
          lines.push(`${line}\n`)
        }
        return lines.join('')
      })
    },
  }
}
