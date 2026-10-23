import type { StandardSchemaV1 } from '@standard-schema/spec'

import type { Directory } from '../identity/directory'
import type { Caller, HttpMethod, OpStatus, Reply, Scope } from '../module/define'

/**
 * What a core op receives besides its input. Unlike a Module's op, it runs privileged: the
 * `directory` and `remove` are on the op's one transaction, so a throw undoes all of it.
 */
export interface CoreCtx {
  caller: Caller
  directory: Directory
  /** The request's time. */
  now: () => Date
  /** Every Scope a Token may hold (`hub.scopes`). */
  scopes: readonly Scope[]
  /** The loaded Modules' names. */
  modules: readonly string[]
  /**
   * Hard deletes through the core's delete-by-Owner and delete-by-Source: the record and
   * every row it owns (or sent) in every Module, on the op's transaction. False when it is absent.
   */
  remove: {
    user(userId: string): Promise<boolean>
    team(teamId: string): Promise<boolean>
    source(sourceId: string): Promise<boolean>
  }
  /** One Module's data for one Owner, streamed as JSON Lines. */
  exportOwner(module: string, ownerId: string): ReadableStream<Uint8Array>
}

/**
 * An op the core serves itself (#30): the Admin API (`admin`) and self-management
 * (`self:manage`). Validated, documented, answered and run in one transaction like a Module's
 * typed op, but privileged: it reaches the `core` tables through the Directory, so it checks who
 * may touch which record itself.
 */
export interface CoreOp {
  key: string
  method: HttpMethod
  path: string
  summary: string
  description?: string | undefined
  /** OpenAPI tag: `admin` for Admins, `self` for a User's own records. */
  tag: 'admin' | 'self'
  scope: 'admin' | 'self:manage'
  input: StandardSchemaV1
  output: StandardSchemaV1
  statuses: readonly OpStatus[]
  /** Replaces the generated responses, for an op that answers a `Response` of its own. */
  responses?: Record<string, unknown> | undefined
  /** Returns the output, a `reply()`, or a whole `Response` (export). */
  run(input: unknown, ctx: CoreCtx): Promise<unknown>
}

export interface CoreOpDef<I, O> extends Omit<CoreOp, 'input' | 'output' | 'statuses' | 'run'> {
  input: StandardSchemaV1<unknown, I>
  output: StandardSchemaV1<O>
  statuses?: readonly [OpStatus, ...OpStatus[]]
  run(input: I, ctx: CoreCtx): Promise<O | Reply<O> | Response>
}

export function coreOp<I, O>(def: CoreOpDef<I, O>): CoreOp {
  return {
    ...def,
    statuses: def.statuses ?? [200],
    // The core validates input against `def.input` before calling, so it is an `I`.
    run: (input, ctx) => def.run(input as I, ctx),
  }
}
