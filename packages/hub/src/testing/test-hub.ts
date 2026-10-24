import { eq, sql } from 'drizzle-orm'
import type { SQLWrapper } from 'drizzle-orm'

import { rows } from '../db/port'
import type { DbPort } from '../db/port'
import { createHub } from '../hub/create-hub'
import type { Hub } from '../hub/create-hub'
import type { HubConfig } from '../hub/boot'
import { noEdgeIdentity } from '../identity/edge'
import type { EdgeIdentityPort } from '../identity/edge'
import { sources, teamMembers, teams, users } from '../identity/tables'
import type { Module, Scope } from '../module/define'
import type { RatesPort } from '../rates/rates'
import { pgliteDb } from './pglite'
import type { ClosableDbPort } from './pglite'

/** Calls a test Hub over HTTP as one principal. Paths are absolute: `/api/v1/notes`. */
export interface TestClient {
  fetch(path: string, init?: RequestInit): Promise<Response>
  get(path: string): Promise<Response>
  post(path: string, body?: unknown): Promise<Response>
  put(path: string, body?: unknown): Promise<Response>
  delete(path: string): Promise<Response>
}

export interface TestHubOptions {
  modules: readonly Module[]
  /** Defaults to a fresh PGLite database; pass a Postgres Adapter to run on a server. */
  db?: ClosableDbPort
  config?: HubConfig
  clock?: () => Date
  /** Defaults to none. Pass `fakeEdgeIdentity(map)` to send Edge Identities. */
  edgeIdentity?: EdgeIdentityPort
  /** Defaults to `noRates()`. */
  rates?: RatesPort
}

export interface AsOptions {
  /** Binds the Token to this Source, created for the User if new: an ingest Token. */
  sourceId?: string
  /** Sends `Embertrail-Owner: team:<id>` on every request, to act for that Team. */
  team?: string
}

export interface TestHub {
  hub: Hub
  db: DbPort
  /**
   * A client holding a real Token for `userId` with `scopes`: the User (and the Source, for
   * `sourceId`) is created with that id if new, and the Token is issued before the first
   * request. Holding `admin` makes the User an Admin.
   */
  as(userId: string, scopes: readonly Scope[], options?: AsOptions): TestClient
  /** Creates the User with this id if new. */
  user(userId: string, options?: { admin?: boolean; email?: string }): Promise<void>
  /** Creates the Team with this id if new, and gives each User their role in it. */
  team(
    teamId: string,
    roles: { editors?: readonly string[]; members?: readonly string[] },
  ): Promise<void>
  /** A client with no Token. */
  anonymous: TestClient
  /** Rows of a query run as the connecting role, outside row-level security. */
  sql<T>(query: SQLWrapper | string): Promise<T[]>
  /** Unexpected errors the Hub answered with a 500, in order. */
  errors: unknown[]
  close(): Promise<void>
}

const base = 'http://hub.test'

function client(hub: Hub, token?: Promise<string>, team?: string): TestClient {
  const send = async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    if (token !== undefined) headers.set('authorization', `Bearer ${await token}`)
    if (team !== undefined) headers.set('embertrail-owner', `team:${team}`)
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
    delete: (path) => send(path, { method: 'DELETE' }),
  }
}

/**
 * The Hub on PGLite: real migrations, real row-level security, and real Users, Sources and
 * Tokens, created on demand by `as()`. Close it when done.
 */
export async function testHub(options: TestHubOptions): Promise<TestHub> {
  const db = options.db ?? pgliteDb()
  const errors: unknown[] = []
  const hub = createHub({
    config: options.config ?? {},
    ports: {
      db,
      edgeIdentity: options.edgeIdentity ?? noEdgeIdentity(),
      ...(options.rates === undefined ? {} : { rates: options.rates }),
    },
    modules: options.modules,
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

  const user: TestHub['user'] = async (userId, { admin = false, email } = {}) => {
    await db.privileged((tx) =>
      tx
        .insert(users)
        .values({ id: userId, name: userId, admin, email: email?.toLowerCase() ?? null })
        .onConflictDoUpdate({
          target: users.id,
          set: {
            admin: sql`${users.admin} or excluded.admin`,
            email: sql`coalesce(excluded.email, ${users.email})`,
          },
        }),
    )
  }

  async function source(userId: string, sourceId: string) {
    const owner = await db.privileged(async (tx) => {
      await tx
        .insert(sources)
        .values({ id: sourceId, ownerId: userId, name: sourceId })
        .onConflictDoNothing()
      const [found] = await tx.select().from(sources).where(eq(sources.id, sourceId))
      return found?.ownerId
    })
    if (owner !== userId) throw new Error(`Source ${sourceId} belongs to ${String(owner)}`)
  }

  return {
    hub,
    db,
    as(userId, scopes, { sourceId, team } = {}) {
      const token = (async () => {
        await user(userId, { admin: scopes.includes('admin') })
        if (sourceId !== undefined) await source(userId, sourceId)
        const issued = await hub.directory.issueToken(userId, {
          kind: sourceId === undefined ? 'management' : 'ingest',
          scopes,
          sourceId,
        })
        return issued.token
      })()
      // A failure surfaces on the client's first request instead.
      void token.catch(() => undefined)
      return client(hub, token, team)
    },
    user,
    async team(teamId, { editors = [], members = [] }) {
      await db.privileged((tx) =>
        tx.insert(teams).values({ id: teamId, name: teamId }).onConflictDoNothing(),
      )
      const roles = [
        ...members.map((id) => [id, 'member'] as const),
        ...editors.map((id) => [id, 'editor'] as const),
      ]
      for (const [userId, role] of roles) {
        await user(userId)
        await db.privileged((tx) =>
          tx
            .insert(teamMembers)
            .values({ teamId, userId, role })
            .onConflictDoUpdate({
              target: [teamMembers.teamId, teamMembers.userId],
              set: { role },
            }),
        )
      }
    },
    anonymous: client(hub),
    sql: (query) => db.privileged((tx) => rows(tx, query)),
    errors,
    close: () => db.close(),
  }
}
