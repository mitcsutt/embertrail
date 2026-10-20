import { dbPortChecks } from '@mitcsutt/embertrail-hub/contract'
import {
  hubInvariantChecks,
  sqlEndpointChecks,
  sqlTimeoutChecks,
} from '@mitcsutt/embertrail-hub/testing'
import { describe, expect, it } from 'vitest'

import { openTempDb } from './testing/temp-database'

// The Docker Db Adapter against Postgres 17: the Db Port contract, then the Module contract's
// invariants, since row-level security on a server could differ from PGLite. Skipped locally
// without DATABASE_URL; in CI a missing database fails the run (docs/development.md).
const databaseUrl = process.env.DATABASE_URL ?? ''

describe.skipIf(databaseUrl === '' && process.env.CI === undefined)(
  'the Docker Db Adapter on Postgres',
  () => {
    const open = () => openTempDb(databaseUrl)

    it.each(dbPortChecks)('$name', async (check) => {
      const db = await open()
      try {
        await expect(check.run(db)).resolves.toBeUndefined()
      } finally {
        await db.close()
      }
    })

    describe('Module contract invariants', () => {
      it.each(hubInvariantChecks)('$name', async (check) => {
        await expect(check.run(open)).resolves.toBeUndefined()
      })
    })

    describe('the read-only SQL endpoint', () => {
      // The timeout check waits out the real 10 s statement timeout.
      it.each([...sqlEndpointChecks, ...sqlTimeoutChecks])(
        '$name',
        async (check) => {
          await expect(check.run(open)).resolves.toBeUndefined()
        },
        30_000,
      )
    })
  },
)
