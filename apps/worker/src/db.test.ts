import { dbPortChecks } from '@mitcsutt/embertrail-hub/contract'
import { hubInvariantChecks } from '@mitcsutt/embertrail-hub/testing'
import { env } from 'cloudflare:workers'
import pg from 'pg'
import { describe, expect, it } from 'vitest'

import { cloudflareDb } from './db'

// The Cloudflare Db Adapter against Postgres 17, through the Worker's Hyperdrive binding. The
// binding's local connection string is a scratch database (`vitest.config.ts`). Skipped locally
// without DATABASE_URL; in CI a missing database fails the run (docs/development.md).
const skip = env.POSTGRES_AVAILABLE === '' && env.RUNNING_IN_CI === ''

/** Drops every schema the checks create, so each check starts from an empty database. */
async function reset() {
  const client = new pg.Client({ connectionString: env.HYPERDRIVE.connectionString })
  // Ending a pg-cloudflare socket fails its pending read; with no listener that is unhandled.
  client.on('error', () => undefined)
  await client.connect()
  try {
    await client.query(`do $$ declare s text; begin
      for s in select nspname from pg_namespace
        where nspname not in ('public', 'information_schema') and nspname not like 'pg\\_%'
      loop execute format('drop schema %I cascade', s); end loop;
    end $$`)
  } finally {
    await client.end()
  }
}

describe.skipIf(skip)('the Cloudflare Db Adapter on Postgres', () => {
  it.each(dbPortChecks)('$name', async (check) => {
    await reset()
    const db = cloudflareDb({ connectionString: env.HYPERDRIVE.connectionString })
    await expect(check.run(db)).resolves.toBeUndefined()
  })

  describe('Module contract invariants', () => {
    it.each(hubInvariantChecks)('$name', async (check) => {
      const open = async () => {
        await reset()
        const db = cloudflareDb({ connectionString: env.HYPERDRIVE.connectionString })
        return { ...db, close: () => Promise.resolve() }
      }
      await expect(check.run(open)).resolves.toBeUndefined()
    })
  })
})
