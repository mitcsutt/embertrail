import { randomUUID } from 'node:crypto'

/**
 * The Postgres 17 server the database tests run against: CI's service container, or `pnpm
 * db:up` locally. Empty when `DATABASE_URL` is unset. Read in Node, by `vitest.config.ts`.
 */
export const databaseUrl = process.env.DATABASE_URL ?? ''

// The config and the global setup each load this module, so the name lives in the environment.
process.env.EMBERTRAIL_WORKER_SCRATCH_DB ??= `embertrail_worker_${randomUUID().replaceAll('-', '')}`

/** The scratch database the Worker's Hyperdrive binding points at for one test run. */
export const scratchDatabase = process.env.EMBERTRAIL_WORKER_SCRATCH_DB

/** `databaseUrl` with its database swapped for `database`. */
export function urlFor(database: string): string {
  const url = new URL(databaseUrl)
  url.pathname = `/${database}`
  return url.toString()
}
