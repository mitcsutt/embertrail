import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { defineModule } from '../module/define'
import { pgliteDb, sqlEndpointChecks, testHub } from '../testing'

// The timeout check (sqlTimeoutChecks) runs on Postgres only, in apps/server: PGLite never
// fires statement_timeout.
describe('POST /api/v1/sql on PGLite', () => {
  it.each(sqlEndpointChecks)('$name', async (check) => {
    await expect(check.run(() => Promise.resolve(pgliteDb()))).resolves.toBeUndefined()
  })

  const empty = defineModule({ contract: 1, name: 'empty', tables: {}, migrations: [], ops: {} })

  it('is in the served OpenAPI document with its Scope', async () => {
    const t = await testHub({ modules: [empty] })
    try {
      expect(t.hub.openapi.paths['/api/v1/sql']?.post).toMatchObject({
        operationId: 'core.sql',
        'x-embertrail-module': 'core',
        'x-embertrail-scope': 'sql:read',
      })
    } finally {
      await t.close()
    }
  })

  it('refuses to run while the read-only role may still call set_config', async () => {
    const t = await testHub({ modules: [empty] })
    try {
      // What a migrate run by a role that doesn't own set_config leaves behind.
      await t.sql(
        sql`grant execute on function pg_catalog.set_config(text, text, boolean) to public`,
      )
      const response = await t.as('alice', ['sql:read']).post('/api/v1/sql', { sql: 'select 1' })
      expect(response.status).toBe(500)
      expect(await response.json()).toMatchObject({
        type: 'urn:embertrail:problem:internal',
        detail: expect.stringContaining('set_config') as unknown,
      })
    } finally {
      await t.close()
    }
  })
})
