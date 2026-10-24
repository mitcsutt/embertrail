import { checkDatabase, migrate } from '../db/migrate'
import type { MigrationReport } from '../db/migrate'
import type { DbPort } from '../db/port'
import { coreDirectory } from '../identity/directory'
import type { Directory } from '../identity/directory'
import type { EdgeIdentityPort } from '../identity/edge'
import { lifecycle } from '../lifecycle/lifecycle'
import { noRates } from '../rates/rates'
import type { RatesPort } from '../rates/rates'
import { coreScopes } from '../module/define'
import type { Module, Scope } from '../module/define'
import { HubError } from '../module/errors'
import { checkModules, checkPaths, parseConfig } from './boot'
import type { HubConfig } from './boot'
import { knownError, OutputError, problem } from './http'
import { buildOpenApi } from './openapi'
import type { OpenApiDocument } from './openapi'
import { hubOps } from './ops'
import { pipeline } from './pipeline'
import type { HubOp, Services } from './pipeline'
import { Router } from './router'

/** The Ports the core needs from a Platform (#26). */
export interface Ports {
  db: DbPort
  edgeIdentity: EdgeIdentityPort
  /** Foreign-exchange rates for `getRates`. Default `noRates()`: the Hub makes no outbound request. */
  rates?: RatesPort
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

  const data = lifecycle({
    db,
    modules,
    clock,
    retentionDays: config.retentionDays,
    onError,
  })

  const services: Services = {
    db,
    directory,
    scopes,
    modules: modules.map((m) => m.name),
    openapi,
    rates: options.ports.rates ?? noRates(),
    remove: data.remove,
    exportOwner: data.exportOwner,
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

    runRetention: data.runRetention,

    exportOwner: data.exportOwner,
  }
}
