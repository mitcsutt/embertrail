import { randomUUID } from 'node:crypto'

import pg from 'pg'

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

async function run(serverUrl: string, statement: string) {
  const client = new pg.Client({ connectionString: serverUrl })
  await client.connect()
  try {
    await client.query(statement)
  } finally {
    await client.end()
  }
}

/** A fresh, empty database on the server, and a function that drops it. */
export async function tempDatabase(serverUrl: string) {
  const name = `embertrail_cli_test_${randomUUID().replaceAll('-', '')}`
  await run(serverUrl, `create database ${name}`)
  const url = new URL(serverUrl)
  url.pathname = `/${name}`
  return {
    url: url.toString(),
    drop: () => run(serverUrl, `drop database if exists ${name} with (force)`),
    /** Runs SQL in the temporary database. */
    exec: (statement: string) => run(url.toString(), statement),
  }
}
