import { sql } from 'drizzle-orm'
import { z } from 'zod'

import type { CoreCtx, CoreOp } from '../admin/core-op'
import { coreOps } from '../admin/ops'
import { checkDatabase, declaredTables, ident, migrate } from '../db/migrate'
import type { MigrationReport } from '../db/migrate'
import { rows } from '../db/port'
import type { DbPort, DbSession, ScopedDb } from '../db/port'
import { accountRecogniser } from '../identity/accounts'
import { coreDirectory, ownerKind } from '../identity/directory'
import type { Directory } from '../identity/directory'
import type { EdgeIdentityPort } from '../identity/edge'
import { bearer, resolveCaller } from '../identity/resolve'
import { hashSecret, sameHash } from '../identity/tokens'
import { coreScopes, isReply, opScope } from '../module/define'
import type { Caller, Ctx, Exporter, Module, Op, OwnerRef, Scope } from '../module/define'
import { HubError } from '../module/errors'
import { runSql, sqlInput } from '../sql/endpoint'
import { checkModules, parseConfig } from './boot'
import type { HubConfig } from './boot'
import { knownError, OutputError, parseOutput, problem, readInput, validate } from './http'
import { docsPage, llmsTxt } from './docs'
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

type Target =
  | { kind: 'core'; respond: (request: Request) => Response | Promise<Response> }
  | { kind: 'coreOp'; op: CoreOp }
  | { kind: 'op'; module: Module; key: string; op: Op }

/** `POST /api/v1/bootstrap`'s optional body: who the first User is. */
const bootstrapInput = z.strictObject({
  name: z.string().min(1).max(200).optional(),
  email: z.email().optional(),
})

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
  const openapi = buildOpenApi(modules, coreOps)
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
  // On the op's own transaction: a second connection would wait on it (PGLite has one).
  const ownerOf =
    (scoped: ScopedDb) =>
    async (ownerId: string): Promise<OwnerRef> => ({
      kind: await ownerKind(scoped, ownerId),
      id: ownerId,
    })

  let booted: Promise<void> | undefined
  const boot = () => {
    booted ??= checkDatabase(db, modules).catch((error: unknown) => {
      booted = undefined
      throw error
    })
    return booted
  }

  /** Exchanges `BOOTSTRAP_TOKEN` for the first User and an admin Token, once (#29). */
  async function bootstrap(request: Request) {
    await boot()
    const presented = bearer(request)
    const expected = config.bootstrapToken
    if (
      presented === undefined ||
      expected === undefined ||
      !sameHash(await hashSecret(presented), await hashSecret(expected))
    ) {
      throw HubError.unauthenticated('Invalid bootstrap Token')
    }
    const input = await validate(bootstrapInput, await readInput(request, {}))
    const first = await directory.createFirstUser(input)
    if (first === null) throw HubError.unauthenticated('The Hub is already bootstrapped')
    return Response.json({ user: first.user, token: first.token })
  }

  /** `POST /api/v1/sql`: one read-only statement under the caller's row-level security (#34). */
  async function sqlEndpoint(request: Request) {
    await boot()
    const caller = await resolveCaller(request, edgeIdentity, directory)
    if (!caller.scopes.includes('sql:read')) throw HubError.forbidden('Needs Scope sql:read')
    const input = await validate(sqlInput, await readInput(request, {}))
    return Response.json(await runSql(db, caller, input))
  }

  const router = new Router<Target>()
  router.add('GET', '/api/v1/openapi.json', { kind: 'core', respond: () => Response.json(openapi) })
  router.add('GET', '/api/v1/docs', {
    kind: 'core',
    respond: () =>
      new Response(docsPage(openapi), {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
        },
      }),
  })
  router.add('GET', '/llms.txt', {
    kind: 'core',
    respond: (request) =>
      new Response(llmsTxt(openapi, new URL(request.url).origin), {
        headers: { 'content-type': 'text/markdown; charset=utf-8' },
      }),
  })
  router.add('POST', '/api/v1/bootstrap', { kind: 'core', respond: bootstrap })
  router.add('POST', '/api/v1/sql', { kind: 'core', respond: sqlEndpoint })
  for (const op of coreOps) router.add(op.method, op.path, { kind: 'coreOp', op })
  for (const module of modules) {
    for (const [key, op] of Object.entries(module.ops))
      router.add(op.method, op.path, { kind: 'op', module, key, op })
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
      ownerOf: ownerOf(scoped),
      account: accountRecogniser(scoped),
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
    (table: 'users' | 'teams' | 'sources', column: 'owner_id' | 'source_id') => (id: string) =>
      db.privileged(async (tx) => {
        const [found] = await rows(
          tx,
          sql`select 1 from ${sql.raw(`core.${table}`)} where id = ${id} for update`,
        )
        if (found === undefined) return false
        await deleteRows(tx, column, id)
        await tx.execute(sql`delete from ${sql.raw(`core.${table}`)} where id = ${id}`)
        return true
      })
  const remove: CoreCtx['remove'] = {
    user: removeRecord('users', 'owner_id'),
    team: removeRecord('teams', 'owner_id'),
    source: removeRecord('sources', 'source_id'),
  }

  /** Runs one of the core's own ops (#30): caller, Scope and input checked as for a Module's. */
  async function serveCoreOp(
    request: Request,
    op: CoreOp,
    params: Record<string, string>,
    requestId: string,
  ) {
    const caller = await resolveCaller(request, edgeIdentity, directory)
    if (!caller.scopes.includes(op.scope)) throw HubError.forbidden(`Needs Scope ${op.scope}`)
    const input = await validate(op.input, await readInput(request, params, {}, 'keep'))
    const now = clock()
    const result = await op.run(input, {
      caller,
      directory,
      now: () => new Date(now),
      scopes,
      modules: modules.map((m) => m.name),
      remove,
      exportOwner: (module, ownerId) => exportOwner(module, ownerId, requestId),
    })
    if (result instanceof Response) return result
    const name = `core.${op.key}`
    const replied = isReply(result) ? result : { status: 200 as const, body: result }
    if (!op.statuses.includes(replied.status)) {
      throw new OutputError(name, [], `answered ${String(replied.status)}, not in its statuses`)
    }
    if (replied.status === 204) return new Response(null, { status: 204 })
    return Response.json(await parseOutput(op.output, replied.body, name), {
      status: replied.status,
    })
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
              const ctx: Ctx = {
                db: scoped,
                caller,
                now: () => new Date(now),
                ownerOf: ownerOf(scoped),
                account: accountRecogniser(scoped),
              }
              for await (const line of exporter(ctx)) {
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
        const { target } = found
        if (target.kind === 'core') return await target.respond(request)
        await boot()
        if (target.kind === 'coreOp')
          return await serveCoreOp(request, target.op, found.params, requestId)
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

    exportOwner,
  }
}
