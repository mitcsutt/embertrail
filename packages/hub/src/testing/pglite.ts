import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'

import { drizzleDbPort } from '../db/port'
import type { DbPort } from '../db/port'
import { EdgeIdentityError } from '../identity/edge'
import type { EdgeIdentityPort } from '../identity/edge'

/** A Db Port the caller closes when done. */
export type ClosableDbPort = DbPort & { close(): Promise<void> }

/**
 * The Test Db Adapter: an in-process PGLite database with real migrations and real
 * row-level security. Each call is a fresh, empty database.
 */
export function pgliteDb(): ClosableDbPort {
  const client = new PGlite()
  return { ...drizzleDbPort(drizzle({ client })), close: () => client.close() }
}

/**
 * The test Edge Identity Adapter: maps a header's value to an email. An unknown value is an
 * invalid assertion. Test-only, so it lives here and never in a Platform's entry file.
 */
export function fakeEdgeIdentity(
  map: Record<string, string>,
  options: { header?: string } = {},
): EdgeIdentityPort {
  const header = options.header ?? 'x-test-edge-identity'
  return {
    verify(request) {
      const value = request.headers.get(header)
      if (value === null) return Promise.resolve(null)
      const email = map[value]
      if (email === undefined) {
        return Promise.reject(new EdgeIdentityError(`Unknown test assertion "${value}"`))
      }
      return Promise.resolve({ email })
    },
  }
}
