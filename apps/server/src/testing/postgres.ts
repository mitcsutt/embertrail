/**
 * The Postgres 17 server the database tests run against: CI's service container, or `pnpm
 * db:up` locally. Empty when `DATABASE_URL` is unset.
 */
export const databaseUrl = process.env.DATABASE_URL ?? ''

/**
 * Pass to `describe.skipIf`. Without `DATABASE_URL` the tests are skipped locally; in CI
 * (`CI` is set) they always run, so a missing database fails the run (docs/development.md).
 */
export const skipWithoutPostgres = databaseUrl === '' && process.env.CI === undefined
