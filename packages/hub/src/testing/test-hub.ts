import type { SQLWrapper } from 'drizzle-orm'

import { rows } from '../db/port'
import type { DbPort } from '../db/port'
import { createHub } from '../hub/create-hub'
import type { Hub } from '../hub/create-hub'
import type { HubConfig } from '../hub/boot'
import { noEdgeIdentity } from '../identity/edge'
import type { Directory, Principal } from '../identity/resolve'
import type { Module, Scope } from '../module/define'
import { pgliteDb } from './pglite'
import type { ClosableDbPort } from './pglite'

/** Calls a test Hub over HTTP as one principal. Paths are absolute: `/api/v1/notes`. */
export interface TestClient {
  fetch(path: string, init?: RequestInit): Promise<Response>
  get(path: string): Promise<Response>
  post(path: string, body?: unknown): Promise<Response>
  put(path: string, body?: unknown): Promise<Response>
  patch(path: string, body?: unknown): Promise<Response>
  delete(path: string): Promise<Response>
}

export interface TestHubOptions {
  modules: readonly Module[]
  /** Defaults to a fresh PGLite database; pass a Postgres Adapter to run on a server. */
  db?: ClosableDbPort
  config?: HubConfig
  clock?: () => Date
}

export interface TestHub {
  hub: Hub
  db: DbPort
  /** A client holding a Token for `userId` with `scopes`, bound to `sourceId` when given. */
  as(userId: string, scopes: readonly Scope[], options?: { sourceId?: string }): TestClient
  /** A client with no Token. */
  anonymous: TestClient
  /** Rows of a query run as the connecting role, outside row-level security. */
  sql<T>(query: SQLWrapper | string): Promise<T[]>
  /** Unexpected errors the Hub answered with a 500, in order. */
  errors: unknown[]
  close(): Promise<void>
}

const base = 'http://hub.test'

function client(hub: Hub, token?: string): TestClient {
  const send = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    if (token !== undefined) headers.set('authorization', `Bearer ${token}`)
    return hub.fetch(new Request(new URL(path, base), { ...init, headers }))
  }
  const withBody = (method: string) => (path: string, body?: unknown) =>
    send(path, {
      method,
      ...(body === undefined
        ? {}
        : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
    })
  return {
    fetch: send,
    get: (path) => send(path),
    post: withBody('POST'),
    put: withBody('PUT'),
    patch: withBody('PATCH'),
    delete: (path) => send(path, { method: 'DELETE' }),
  }
}

/**
 * The Hub on PGLite with a fake Identity: real migrations, real row-level security, and
 * Tokens issued on demand by `as()`. Close it when done.
 */
export async function testHub(options: TestHubOptions): Promise<TestHub> {
  const db = options.db ?? pgliteDb()
  const tokens = new Map<string, Principal>()
  const directory: Directory = {
    token: (token) => Promise.resolve(tokens.get(token) ?? null),
    edgeUser: () => Promise.resolve(null),
  }
  const errors: unknown[] = []
  const hub = createHub({
    config: options.config ?? {},
    ports: { db, edgeIdentity: noEdgeIdentity() },
    modules: options.modules,
    directory,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    onError: (error) => errors.push(error),
  })
  try {
    await hub.migrate()
    await hub.boot()
  } catch (error) {
    await db.close()
    throw error
  }
  return {
    hub,
    db,
    as(userId, scopes, { sourceId } = {}) {
      const token = `test_${String(tokens.size + 1)}`
      tokens.set(token, { userId, scopes, sourceId })
      return client(hub, token)
    },
    anonymous: client(hub),
    sql: (query) => db.privileged((tx) => rows(tx, query)),
    errors,
    close: () => db.close(),
  }
}
