import { assertModuleContract, testHub } from '@mitcsutt/embertrail-hub/testing'
import { otel } from '@mitcsutt/embertrail-otel'
import { claudeCode, fixtureText, pathOf, postOtlp } from '@mitcsutt/embertrail-otel/testing'
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { openTempDb } from './testing/temp-database'

// The otel Module on Postgres 17 through the Docker Db Adapter: the batched unnest insert,
// its conflict keys and the OTLP JSON Lines export depend on the server's types and indexes,
// which PGLite only approximates. Skipped locally without DATABASE_URL, as db.test.ts is.
const databaseUrl = process.env.DATABASE_URL ?? ''
const fixtures = Object.values(claudeCode)

describe.skipIf(databaseUrl === '' && process.env.CI === undefined)(
  'the otel Module on Postgres',
  () => {
    it('passes the Module contract suite', async () => {
      await assertModuleContract(otel, {
        db: await openTempDb(databaseUrl),
        async seed(client) {
          for (const name of fixtures) {
            expect((await postOtlp(client, pathOf(name), fixtureText(name))).status).toBe(200)
          }
        },
      })
    })

    it('stores each fixture once when it is posted twice, and round trips the export', async () => {
      const first = await testHub({ modules: [otel], db: await openTempDb(databaseUrl) })
      const second = await testHub({ modules: [otel], db: await openTempDb(databaseUrl) })
      try {
        const sender = first.as('alice', ['otel:write'], { sourceId: 'laptop' })
        for (const name of [...fixtures, ...fixtures]) {
          expect((await postOtlp(sender, pathOf(name), fixtureText(name))).status).toBe(200)
        }
        const rows = (t: typeof first) =>
          t.sql(sql`select 'logs' as t, to_jsonb(r) - 'id' as row from otel.otel_logs r
            union all select 'sum', to_jsonb(r) - 'id' from otel.otel_metrics_sum r
            order by 1, 2`)
        expect(await rows(first)).toHaveLength(56 + 20)

        const replayer = second.as('alice', ['otel:write'], { sourceId: 'laptop' })
        for (const line of (await first.hub.exportOwner('otel', 'alice')).split('\n')) {
          if (line === '') continue
          const path = line.startsWith('{"resourceLogs"') ? '/v1/logs' : '/v1/metrics'
          expect(await (await postOtlp(replayer, path, line)).json()).toEqual({})
        }
        expect(await rows(second)).toEqual(await rows(first))
        expect([...first.errors, ...second.errors]).toEqual([])
      } finally {
        await first.close()
        await second.close()
      }
    })
  },
)
