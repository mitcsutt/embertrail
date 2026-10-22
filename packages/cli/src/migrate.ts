import { createHub, noEdgeIdentity } from '@mitcsutt/embertrail-hub'
import type { DbPort, MigrationReport } from '@mitcsutt/embertrail-hub'
import { otel } from '@mitcsutt/embertrail-otel'
import { store } from '@mitcsutt/embertrail-store'

/**
 * The Modules a Hub built from this repository loads, in dependency order. Every Platform's entry
 * file lists the same ones, so `embertrail migrate` migrates what the Hub will boot with.
 */
export const hubModules = [otel, store]

/**
 * Core migrations, then each Module's, then the policy sync (#25), in one transaction. Applying
 * nothing when the database is current makes it safe to repeat; a database with migrations this
 * version doesn't know fails with a `HubBootError` before anything changes.
 */
export function migrateDatabase(db: DbPort): Promise<MigrationReport> {
  const hub = createHub({
    config: {},
    ports: { db, edgeIdentity: noEdgeIdentity() },
    modules: hubModules,
  })
  return hub.migrate()
}
