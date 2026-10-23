import { migrateModules } from '@mitcsutt/embertrail-hub'
import type { DbPort, MigrationReport } from '@mitcsutt/embertrail-hub'
import { otel } from '@mitcsutt/embertrail-otel'
import { store } from '@mitcsutt/embertrail-store'

/**
 * The Modules a Hub built from this repository loads, in dependency order. Every Platform boots
 * with them, `embertrail migrate` migrates them, and the cross-package tests run against them, so
 * a new Module is added here and nowhere else.
 */
export const hubModules = [otel, store]

/**
 * `embertrail migrate` over `hubModules`: core migrations, then each Module's, then the policy
 * sync (#25), in one transaction. It needs only the Db Port: no Hub config and no Edge Identity.
 */
export function migrateDatabase(db: DbPort): Promise<MigrationReport> {
  return migrateModules(db, hubModules)
}
