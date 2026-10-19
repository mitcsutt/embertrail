import pg from 'pg'
import { describe, expect, it } from 'vitest'

// Proves the test environment reaches Postgres 17: CI's service container, or `pnpm db:up`
// locally. Skipped locally without DATABASE_URL; in CI a missing database fails the run.
const databaseUrl = process.env.DATABASE_URL

describe.skipIf(databaseUrl === undefined && process.env.CI === undefined)('Postgres', () => {
  it('is reachable and on version 17', async () => {
    const client = new pg.Client({ connectionString: databaseUrl })
    await client.connect()
    try {
      const result = await client.query<{ server_version_num: string }>('SHOW server_version_num')
      const version = Number(result.rows[0]?.server_version_num)
      expect(Math.floor(version / 10_000)).toBe(17)
    } finally {
      await client.end()
    }
  })
})
