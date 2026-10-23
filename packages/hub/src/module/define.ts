import type { StandardSchemaV1 } from '@standard-schema/spec'
import { sql } from 'drizzle-orm'
import { pgSchema, text } from 'drizzle-orm/pg-core'
import type { PgColumnBuilderBase, PgTable } from 'drizzle-orm/pg-core'

import type { ScopedDb } from '../db/port'

/** The contract major this Hub implements. The Hub refuses any other. */
export const contractVersion = 1

/** A permission naming one Module and one verb, such as `otel:write`, or `admin`. */
export type Scope = `${string}:${string}` | 'admin'

/**
 * Scopes the core defines (#27, #29): `admin` (Admin), `self:manage` (a User's own
 * Sources, Tokens, Accounts and Grants) and `sql:read` (the read-only SQL endpoint).
 */
export const coreScopes: readonly Scope[] = ['admin', 'self:manage', 'sql:read']

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

/** A status a typed op answers with. 204 sends no body. */
export type OpStatus = 200 | 201 | 204

/** Who owns a row: a User, or a Team (#29). */
export interface OwnerRef {
  kind: 'user' | 'team'
  id: string
}

/** Who is calling, resolved by the core before any op runs. */
export interface Caller {
  userId: string
  /** The Owner new rows are stamped with: the User, or a Team they act for. */
  ownerId: string
  /** Set only for a Source-bound Token. */
  sourceId?: string | undefined
  scopes: readonly Scope[]
  /** When the caller's Token expires; unset for a Token that never does, or an Edge Identity. */
  expiresAt?: Date | undefined
}

/** What an op receives besides its input. */
export interface Ctx {
  /** Drizzle on this op's transaction, with row-level security applied for `caller`. */
  db: ScopedDb
  caller: Caller
  /** The request's time, fixed for the whole op. */
  now: () => Date
  /** Whether an `owner_id` names a User or a Team. */
  ownerOf: (ownerId: string) => Promise<OwnerRef>
  /**
   * The Account (#29) that telemetry attributes name, created on first sight, for the
   * caller's User: `organization.id` + `user.account_uuid`, else `user.email`, else the
   * caller's Source's Unknown Account (which needs a Source-bound caller). Store the id in
   * an `account_id` column so Grants apply to the row. The Account is the caller's User's
   * even when acting for a Team, so don't store it on Team-owned rows.
   */
  account: (attributes: Readonly<Record<string, unknown>>) => Promise<string>
}

declare const replyBrand: unique symbol

/** What a typed op returns instead of its bare output to set its status or `ETag`. */
export interface Reply<O> {
  readonly [replyBrand]: true
  readonly status: OpStatus
  readonly body: O
  readonly etag?: string | undefined
}

const replies = new WeakSet<object>()

/**
 * Answers with `status` (default 200) and an `ETag` header. The status must be one of the
 * op's `statuses`. `body` is still parsed through the op's output schema.
 */
export function reply<O>(body: O, init: { status?: 200 | 201; etag?: string } = {}): Reply<O> {
  const result = { status: init.status ?? 200, body, etag: init.etag }
  replies.add(result)
  return result as unknown as Reply<O>
}

/** 204 with no body. The op's `statuses` must list 204. */
reply.noContent = (): Reply<never> => {
  const result = { status: 204, body: undefined }
  replies.add(result)
  return result as unknown as Reply<never>
}

/** Whether an op's return value came from `reply()`. */
export function isReply(value: unknown): value is Reply<unknown> {
  return typeof value === 'object' && value !== null && replies.has(value)
}

export interface OpDef<I, O> {
  /** REST binding, OpenAPI style: `/api/v1/notes/{id}`. */
  path: string
  /** Path, query and body merged. `owner_id` and `source_id` are stripped first. */
  input: StandardSchemaV1<unknown, I>
  output: StandardSchemaV1<O>
  summary: string
  /** Narrows the derived Scope; must stay within `<name>:` or be `admin`. */
  scope?: Scope
  /**
   * Input keys read from request headers instead of the body or query, such as
   * `{ if_match: 'If-Match' }`. OpenAPI lists them as header parameters.
   */
  headers?: Record<string, string>
  /** Every status `run` answers with, through `reply()`. Default `[200]`. */
  statuses?: readonly [OpStatus, ...OpStatus[]]
  /** Documents the `ETag` response header that `run` sets through `reply()`. */
  etag?: boolean
  /** Reserved: the MCP binder arrives later. */
  bind?: { mcp?: { tool: string } | false }
  run(input: I, ctx: Ctx): Promise<O | Reply<O>>
}

/** What `op.mutate` adds: it may take a Token bound to a Source. */
export interface AcceptsSource {
  /**
   * Accept a Token bound to a Source (an ingest Token). Without it the op refuses one with 403,
   * so a leaked device Token cannot reach it.
   */
  acceptsSource?: boolean
}

export interface RawDef {
  method: HttpMethod
  path: string
  summary: string
  scope?: Scope
  /** Refuse callers whose Token isn't bound to a Source, as `op.ingest` does. */
  sourceBound?: boolean
  /** The OpenAPI Operation Object for this route; the core adds the Module and Scope. */
  openapi: Record<string, unknown>
  bind?: { mcp?: { tool: string } | false }
  run(request: Request, ctx: Ctx): Promise<Response>
}

/**
 * How an op treats a Token bound to a Source: `require` one (ingest), `accept` one, or
 * `refuse` one (the default, so a Module is safe without declaring anything).
 */
export type SourceBinding = 'require' | 'accept' | 'refuse'

interface OpBase {
  readonly source: SourceBinding
  readonly method: HttpMethod
  readonly path: string
  readonly summary: string
  readonly scope?: Scope | undefined
  readonly bind?: { mcp?: { tool: string } | false } | undefined
}

export interface TypedOp extends OpBase {
  readonly kind: 'query' | 'mutate' | 'ingest'
  readonly input: StandardSchemaV1
  readonly output: StandardSchemaV1
  readonly headers: Readonly<Record<string, string>>
  readonly statuses: readonly OpStatus[]
  readonly etag: boolean
  readonly run: (input: unknown, ctx: Ctx) => Promise<unknown>
}

export interface RawOp extends OpBase {
  readonly kind: 'raw'
  readonly openapi: Record<string, unknown>
  readonly run: (request: Request, ctx: Ctx) => Promise<Response>
}

/** One operation, transport-agnostic: HTTP binds it by `method` and `path`. */
export type Op = TypedOp | RawOp

function typed<I, O>(
  kind: TypedOp['kind'],
  method: HttpMethod,
  def: OpDef<I, O> & AcceptsSource,
): TypedOp {
  return {
    kind,
    source: kind === 'ingest' ? 'require' : def.acceptsSource ? 'accept' : 'refuse',
    method,
    path: def.path,
    summary: def.summary,
    scope: def.scope,
    bind: def.bind,
    input: def.input,
    output: def.output,
    headers: def.headers ?? {},
    statuses: def.statuses ?? [200],
    etag: def.etag ?? false,
    // The core validates input against `def.input` before calling, so it is an `I`.
    run: (input, ctx) => def.run(input as I, ctx),
  }
}

/** Builders for a Module's ops. Each derives its Scope from its kind. */
export const op = {
  /** Reads. Default Scope `<name>:read`. */
  query<I, O>(def: OpDef<I, O> & { method: 'GET' | 'POST' }): Op {
    return typed('query', def.method, def)
  },
  /** Writes. Default Scope `<name>:write`. */
  mutate<I, O>(def: OpDef<I, O> & AcceptsSource & { method: 'PUT' | 'POST' | 'DELETE' }): Op {
    return typed('mutate', def.method, def)
  },
  /** Writes from a Source: needs a Source-bound Token. Always POST. Default `<name>:write`. */
  ingest<I, O>(def: OpDef<I, O>): Op {
    return typed('ingest', 'POST', def)
  },
  /**
   * Parses its own body (OTLP). Keeps auth, Scopes and stamping; gives up derived
   * validation and OpenAPI, so it declares its own Operation Object. Default `<name>:write`.
   */
  raw(def: RawDef): Op {
    return {
      kind: 'raw',
      source: def.sourceBound ? 'require' : 'refuse',
      method: def.method,
      path: def.path,
      summary: def.summary,
      scope: def.scope,
      bind: def.bind,
      openapi: def.openapi,
      run: (request, ctx) => def.run(request, ctx),
    }
  },
}

declare const ownedBrand: unique symbol

/** A table built with `moduleSchema(name).ownedTable`: Owner-stamped, under row-level security. */
export type OwnedTable<T extends PgTable = PgTable> = T & { readonly [ownedBrand]: true }

const ownedTables = new WeakMap<PgTable, { signal: boolean }>()

/** Whether a table came from `ownedTable`, and whether it holds Signals. */
export function ownedTableInfo(table: PgTable) {
  return ownedTables.get(table)
}

const ownerColumns = () => ({
  ownerId: text('owner_id')
    .notNull()
    .default(sql`nullif(current_setting('embertrail.owner_id', true), '')`),
})

const sourceColumns = () => ({
  sourceId: text('source_id')
    .notNull()
    .default(sql`nullif(current_setting('embertrail.source_id', true), '')`),
})

type OwnerColumns = ReturnType<typeof ownerColumns>
type SourceColumns = ReturnType<typeof sourceColumns>

/**
 * A Module's Postgres schema. Its `ownedTable` adds `owner_id` (and `source_id` for Signal
 * tables), each defaulting to the caller's setting; the core's policy sync adds row-level
 * security that rejects any other value. Module code never writes either column.
 */
export function moduleSchema<N extends string>(name: N) {
  const schema = pgSchema(name)
  return {
    name,
    ownedTable<
      T extends string,
      C extends Record<string, PgColumnBuilderBase>,
      S extends boolean = false,
    >(table: T, columns: C, options?: { signal?: S }) {
      const signal = options?.signal === true
      const all = { ...columns, ...ownerColumns(), ...(signal ? sourceColumns() : {}) } as C &
        OwnerColumns &
        (S extends true ? SourceColumns : unknown)
      const built = schema.table(table, all)
      ownedTables.set(built, { signal })
      return built as OwnedTable<typeof built>
    },
  }
}

/** A migration: `--> statement-breakpoint` separates statements, as drizzle-kit writes them. */
export interface Migration {
  /** Unique within the Module; applied in array order and recorded once applied. */
  id: string
  sql: string
}

/** Streams a Module's export for one Owner, one JSON Lines entry per item. */
export type Exporter = (ctx: Ctx) => AsyncIterable<string>

export interface ModuleDef<N extends string> {
  /** The Hub refuses unknown majors. */
  contract: typeof contractVersion
  /** Postgres schema name and Scope prefix. */
  name: N
  tables: Record<string, OwnedTable>
  migrations: readonly Migration[]
  ops: Record<string, Op>
  /** Rows older than `RETENTION_DAYS` by this column are swept; omitted keeps them forever. */
  retention?: { column: string }
  /** Default: JSON Lines of every owned row. */
  export?: Exporter
  /** Modules whose migrations must run first. */
  dependsOn?: readonly string[]
}

export interface Module<N extends string = string> extends Readonly<ModuleDef<N>> {
  /** Derived from the ops: what a Token can be granted for this Module. */
  readonly scopes: readonly Scope[]
}

/** The Scope an op requires: its own, or the one derived from its kind. */
export function opScope(moduleName: string, op: Op): Scope {
  return op.scope ?? `${moduleName}:${op.kind === 'query' ? 'read' : 'write'}`
}

/** Declares a Module. Its rules are checked when a Hub boots with it. */
export function defineModule<N extends string>(def: ModuleDef<N>): Module<N> {
  const scopes = [...new Set(Object.values(def.ops).map((o) => opScope(def.name, o)))]
  return { ...def, scopes }
}
