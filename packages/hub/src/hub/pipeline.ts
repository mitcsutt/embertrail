import type { StandardSchemaV1 } from '@standard-schema/spec'

import type { CoreCtx } from '../admin/core-op'
import type { DbPort, DbSession, ScopedDb } from '../db/port'
import type { Directory, Resolver } from '../identity/directory'
import type { EdgeIdentityPort } from '../identity/edge'
import { bearer, resolveCaller } from '../identity/resolve'
import { hashSecret, sameHash } from '../identity/tokens'
import { isReply } from '../module/define'
import type { Caller, HttpMethod, OpStatus, Scope, SourceBinding } from '../module/define'
import { HubError } from '../module/errors'
import { OutputError, parseOutput, readInput, validate } from './http'
import type { OpenApiDocument } from './openapi'

/**
 * Who may call an op: `anyone` (the op never reaches the database), the holder of
 * `BOOTSTRAP_TOKEN`, or a caller holding `scope`, with the op's rule for a Token bound to a
 * Source (#74).
 */
export type Auth =
  | { kind: 'public' }
  | { kind: 'bootstrap' }
  | { kind: 'scope'; scope: Scope; source: SourceBinding }

/**
 * What the pipeline opens around an op: `scoped` is one transaction as the caller, under
 * row-level security (a Module's ops); `privileged` is one transaction outside row-level
 * security, for an op that serves no one caller's rows; `none` leaves the op to reach the database itself.
 */
export type Transaction = 'scoped' | 'privileged' | 'none'

/** What the Hub hands every op, whoever defined it. */
export interface Services {
  db: DbPort
  directory: Directory
  /** Every Scope a Token may hold (`hub.scopes`). */
  scopes: readonly Scope[]
  /** The loaded Modules' names. */
  modules: readonly string[]
  openapi: OpenApiDocument
  remove: CoreCtx['remove']
  exportOwner(module: string, ownerId: string, requestId: string): ReadableStream<Uint8Array>
}

/** One request to one op, after the pipeline has checked who sent it. */
export interface Call {
  request: Request
  /** Set for `scope` auth; unset for `public` and `bootstrap`. */
  caller: Caller | undefined
  /** The request's time. */
  now: Date
  requestId: string
  /** The op's transaction, for `transaction: 'scoped'`. */
  db: ScopedDb | undefined
  hub: Services
}

interface HubOpBase {
  /** The Module that defines the op, or `core`: who an unexpected error is blamed on. */
  module: string
  /** Unique within `module`; the OpenAPI operationId is `<module>.<key>`. */
  key: string
  method: HttpMethod
  path: string
  auth: Auth
  transaction: Transaction
  summary: string
  description?: string | undefined
  tags?: readonly string[] | undefined
}

/** An op the core validates, answers and documents from its schemas. */
export interface TypedHubOp extends HubOpBase {
  kind: 'typed'
  input: StandardSchemaV1
  output: StandardSchemaV1
  /** Input keys read from request headers instead of the body or query. */
  headers: Readonly<Record<string, string>>
  statuses: readonly OpStatus[]
  /** Documents the `ETag` response header. */
  etag: boolean
  /** Whether `owner_id` and `source_id` are removed from the input (`readInput`). */
  stamped: 'strip' | 'keep'
  /** Documents the `Embertrail-Owner` header: a Module's writes. */
  ownerHeader: boolean
  /** Replaces the generated responses, for an op that answers a `Response` of its own. */
  responses?: Record<string, unknown> | undefined
  /** Returns the output, a `reply()`, or a whole `Response`. */
  run(input: unknown, call: Call): Promise<unknown>
}

/** An op that reads the `Request` itself and answers a `Response`, documented by `openapi`. */
export interface RawHubOp extends HubOpBase {
  kind: 'raw'
  openapi: Record<string, unknown>
  run(call: Call): Promise<Response>
}

/** Every route the Hub serves is one of these (#79). */
export type HubOp = TypedHubOp | RawHubOp

/** What an op that needs a caller or a transaction reads from its `Call`. */
export function needs<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`the op runs without ${what}`)
  return value
}

/**
 * The reply sequence, for every typed op: a whole `Response` as is, else the status checked
 * against the op's `statuses`, 204 with no body, the output parsed by its schema, and `ETag`.
 */
export async function answer(op: TypedHubOp, result: unknown): Promise<Response> {
  if (result instanceof Response) return result
  const name = `${op.module}.${op.key}`
  const replied = isReply(result) ? result : { status: 200 as const, body: result }
  if (!op.statuses.includes(replied.status)) {
    throw new OutputError(name, [], `answered ${String(replied.status)}, not in its statuses`)
  }
  const etag = 'etag' in replied ? replied.etag : undefined
  const headers = etag === undefined ? undefined : { etag }
  if (replied.status === 204) return new Response(null, { status: 204, headers })
  return Response.json(await parseOutput(op.output, replied.body, name), {
    status: replied.status,
    headers,
  })
}

export interface PipelineDeps {
  /** Checks the database once, before the first op that reaches it. */
  boot: () => Promise<void>
  db: DbPort
  edgeIdentity: EdgeIdentityPort
  /** Who a Token or Edge Identity names. */
  resolver: Resolver
  bootstrapToken: string | undefined
  clock: () => Date
  services: Services
}

/**
 * The one path every request takes (#79): the database check, the caller and its Scope, the
 * input, then the op's transaction, its run and its reply.
 */
export function pipeline(deps: PipelineDeps) {
  const { db, edgeIdentity, resolver } = deps

  async function authorise(auth: Auth, request: Request): Promise<Caller | undefined> {
    if (auth.kind === 'public') return undefined
    if (auth.kind === 'bootstrap') {
      const presented = bearer(request)
      const expected = deps.bootstrapToken
      if (
        presented === undefined ||
        expected === undefined ||
        !sameHash(await hashSecret(presented), await hashSecret(expected))
      ) {
        throw HubError.unauthenticated('Invalid bootstrap Token')
      }
      return undefined
    }
    const caller = await resolveCaller(request, edgeIdentity, resolver)
    if (!caller.scopes.includes(auth.scope)) throw HubError.forbidden(`Needs Scope ${auth.scope}`)
    if (auth.source === 'require' && caller.sourceId === undefined) {
      throw HubError.forbidden('Needs a Token bound to a Source')
    }
    if (auth.source === 'refuse' && caller.sourceId !== undefined) {
      throw HubError.forbidden('Needs a Token not bound to a Source')
    }
    return caller
  }

  /**
   * Everything before the op runs: a failure here is the core's. Returns the op's run, whose
   * unexpected errors are the op's Module's.
   */
  async function prepare(
    op: HubOp,
    request: Request,
    params: Record<string, string>,
    requestId: string,
  ): Promise<() => Promise<Response>> {
    if (op.auth.kind !== 'public') await deps.boot()
    const caller = await authorise(op.auth, request)
    const input =
      op.kind === 'raw'
        ? undefined
        : await validate(op.input, await readInput(request, params, op.headers, op.stamped))
    const now = deps.clock()
    const respond = async (scoped: ScopedDb | undefined) => {
      const call: Call = { request, caller, now, requestId, db: scoped, hub: deps.services }
      return op.kind === 'raw' ? op.run(call) : answer(op, await op.run(input, call))
    }
    if (op.transaction === 'none') return () => respond(undefined)
    if (op.transaction === 'privileged') return () => db.privileged(respond)
    const { userId, ownerId, sourceId } = needs(caller, 'a caller')
    const session: DbSession = { role: 'app', userId, ownerId, sourceId }
    // The reply is parsed inside the transaction, so output that fails its schema rolls back.
    return () => db.transaction(session, respond)
  }

  return { prepare }
}
