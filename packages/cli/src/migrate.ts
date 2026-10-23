import { createHub, noEdgeIdentity } from '@mitcsutt/embertrail-hub'
import type { DbPort, MigrationReport } from '@mitcsutt/embertrail-hub'
import { hubModules } from '@mitcsutt/embertrail-server'

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

export { hubModules }
