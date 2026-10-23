import { z } from 'zod'

import type { CoreOp } from '../admin/core-op'
import { coreOps } from '../admin/ops'
import type { ScopedDb } from '../db/port'
import { accountRecogniser } from '../identity/accounts'
import { ownerKind } from '../identity/directory'
import { opScope } from '../module/define'
import type { Caller, Ctx, Module, Op } from '../module/define'
import { HubError } from '../module/errors'
import { runSql, sqlInput, sqlRowLimit } from '../sql/endpoint'
import { docsPage, llmsTxt } from './docs'
import { needs } from './pipeline'
import type { Call, HubOp } from './pipeline'

/** A Module op's `ctx`, on `db`: the op's transaction, or an export's. */
export function moduleCtx(db: ScopedDb, caller: Caller, now: Date): Ctx {
  return {
    db,
    caller,
    now: () => new Date(now),
    // On the op's own transaction: a second connection would wait on it (PGLite has one).
    ownerOf: async (ownerId) => ({ kind: await ownerKind(db, ownerId), id: ownerId }),
    account: accountRecogniser(db),
  }
}

const callCtx = (call: Call) =>
  moduleCtx(needs(call.db, 'a transaction'), needs(call.caller, 'a caller'), call.now)

/** `POST /api/v1/bootstrap`'s optional body: who the first User is. */
const bootstrapInput = z.strictObject({
  name: z.string().min(1).max(200).optional(),
  email: z.email().optional(),
})

const bootstrapOutput = z.object({
  user: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string().nullable(),
    admin: z.boolean(),
  }),
  token: z.string().describe('`et_<id>_<secret>`'),
})

/** `SqlResult` in spec/query-api.yaml. */
const sqlOutput = z.object({
  columns: z.array(z.object({ name: z.string(), type: z.string() })),
  rows: z.array(z.array(z.unknown())).max(sqlRowLimit),
  truncated: z.boolean(),
})

const meta = {
  module: 'core',
  method: 'GET',
  auth: { kind: 'public' },
  transaction: 'none',
  tags: ['meta'],
} as const

/** The routes the core serves besides the Admin and self-management API (#30). */
const ownOps: readonly HubOp[] = [
  {
    ...meta,
    kind: 'raw',
    key: 'openapi',
    path: '/api/v1/openapi.json',
    summary: 'This document',
    openapi: {
      responses: {
        '200': {
          description: 'The OpenAPI document',
          content: { 'application/json': { schema: { type: 'object' } } },
        },
      },
    },
    run: (call) => Promise.resolve(Response.json(call.hub.openapi)),
  },
  {
    ...meta,
    kind: 'raw',
    key: 'docs',
    path: '/api/v1/docs',
    summary: 'Human-readable API reference rendered from `openapi.json`',
    openapi: {
      responses: {
        '200': {
          description: 'HTML page.',
          content: { 'text/html': { schema: { type: 'string' } } },
        },
      },
    },
    run: (call) =>
      Promise.resolve(
        new Response(docsPage(call.hub.openapi), {
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
          },
        }),
      ),
  },
  {
    ...meta,
    kind: 'raw',
    key: 'llmsTxt',
    path: '/llms.txt',
    summary: 'Plain-text pointer to the API for AI agents',
    openapi: {
      responses: {
        '200': {
          description: 'Markdown text.',
          content: { 'text/markdown': { schema: { type: 'string' } } },
        },
      },
    },
    run: (call) =>
      Promise.resolve(
        new Response(llmsTxt(call.hub.openapi, new URL(call.request.url).origin), {
          headers: { 'content-type': 'text/markdown; charset=utf-8' },
        }),
      ),
  },
  {
    kind: 'typed',
    module: 'core',
    key: 'bootstrap',
    method: 'POST',
    path: '/api/v1/bootstrap',
    summary: 'Exchange BOOTSTRAP_TOKEN for the first User and an admin Token, once',
    description:
      'Authenticates with `Authorization: Bearer <BOOTSTRAP_TOKEN>`, not a Token. Answers 401 once an admin User exists or bootstrap has been used, and when BOOTSTRAP_TOKEN is unset or wrong.',
    tags: ['admin'],
    // Exchanges `BOOTSTRAP_TOKEN` for the first User and an admin Token, once (#29).
    auth: { kind: 'bootstrap' },
    transaction: 'none',
    input: bootstrapInput,
    output: bootstrapOutput,
    headers: {},
    statuses: [200],
    etag: false,
    stamped: 'strip',
    ownerHeader: false,
    async run(input, call) {
      const first = await call.hub.directory.createFirstUser(
        input as z.infer<typeof bootstrapInput>,
      )
      if (first === null) throw HubError.unauthenticated('The Hub is already bootstrapped')
      return first
    },
  },
  {
    kind: 'typed',
    module: 'core',
    key: 'sql',
    method: 'POST',
    path: '/api/v1/sql',
    summary: 'Run one read-only SQL statement',
    description:
      'Runs a single `SELECT` as the read-only database role, with the caller’s row-level security applied. 10 s statement timeout; at most 10,000 rows, and `truncated` says whether more existed.',
    tags: ['sql'],
    // One read-only statement under the caller's row-level security (#34). `runSql` opens its
    // own transaction as the read-only role.
    auth: { kind: 'scope', scope: 'sql:read', source: 'accept' },
    transaction: 'none',
    input: sqlInput,
    output: sqlOutput,
    headers: {},
    statuses: [200],
    etag: false,
    stamped: 'strip',
    ownerHeader: false,
    run: (input, call) =>
      runSql(call.hub.db, needs(call.caller, 'a caller'), input as z.infer<typeof sqlInput>),
  },
]

/**
 * One of the core's own ops (#30): it reaches the `core` tables through the Directory, so it
 * keeps `source_id` in its input and checks who may touch which record itself.
 */
function fromCoreOp(op: CoreOp): HubOp {
  return {
    kind: 'typed',
    module: 'core',
    key: op.key,
    method: op.method,
    path: op.path,
    summary: op.summary,
    description: op.description,
    tags: [op.tag],
    auth: { kind: 'scope', scope: op.scope, source: 'accept' },
    transaction: 'none',
    input: op.input,
    output: op.output,
    headers: {},
    statuses: op.statuses,
    etag: false,
    stamped: 'keep',
    ownerHeader: false,
    responses: op.responses,
    run: (input, call) =>
      op.run(input, {
        caller: needs(call.caller, 'a caller'),
        directory: call.hub.directory,
        now: () => new Date(call.now),
        scopes: call.hub.scopes,
        modules: call.hub.modules,
        remove: call.hub.remove,
        exportOwner: (module, ownerId) => call.hub.exportOwner(module, ownerId, call.requestId),
      }),
  }
}

/** A Module's op, run in one transaction as its caller. */
function fromModuleOp(module: Module, key: string, op: Op): HubOp {
  const base = {
    module: module.name,
    key,
    method: op.method,
    path: op.path,
    summary: op.summary,
    auth: { kind: 'scope', scope: opScope(module.name, op), source: op.source },
    transaction: 'scoped',
  } as const
  if (op.kind === 'raw') {
    return {
      ...base,
      kind: 'raw',
      openapi: op.openapi,
      run: (call) => op.run(call.request, callCtx(call)),
    }
  }
  return {
    ...base,
    kind: 'typed',
    input: op.input,
    output: op.output,
    headers: op.headers,
    statuses: op.statuses,
    etag: op.etag,
    stamped: 'strip',
    ownerHeader: op.kind === 'mutate',
    run: (input, call) => op.run(input, callCtx(call)),
  }
}

/**
 * Every route the Hub serves, the core's first (#79): the router, the duplicate-path check
 * and the OpenAPI document are all built from this list. `extra` adds core ops (tests).
 */
export function hubOps(modules: readonly Module[], extra: readonly HubOp[] = []): HubOp[] {
  return [
    ...ownOps,
    ...coreOps.map(fromCoreOp),
    ...extra,
    ...modules.flatMap((module) =>
      Object.entries(module.ops).map(([key, op]) => fromModuleOp(module, key, op)),
    ),
  ]
}
