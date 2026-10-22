import { pgliteDb } from '@mitcsutt/embertrail-hub/testing'
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { run } from './cli.ts'
import { migrateDatabase } from './migrate.ts'
import { databaseUrl, skipWithoutPostgres, tempDatabase } from './testing/postgres.ts'

describe('migrateDatabase', () => {
  it('applies core, then each Module, and is idempotent', async () => {
    const db = pgliteDb()
    try {
      const first = await migrateDatabase(db)
      expect(first.applied.map((m) => m.schema)).toEqual(
        expect.arrayContaining(['core', 'otel', 'store']),
      )
      expect(first.applied[0]).toMatchObject({ schema: 'core', id: '0000_roles' })

      expect((await migrateDatabase(db)).applied).toEqual([])
    } finally {
      await db.close()
    }
  })

  it('fails clearly, changing nothing, when the database is ahead of the code', async () => {
    const db = pgliteDb()
    try {
      await migrateDatabase(db)
      await db.privileged((tx) =>
        tx.execute(
          sql`insert into core.migrations (schema, id) values ('otel', '9999_from_the_future')`,
        ),
      )
      await expect(migrateDatabase(db)).rejects.toThrow(
        /otel.*migrations ahead.*9999_from_the_future/,
      )
    } finally {
      await db.close()
    }
  })
})

/** Runs `embertrail migrate` against `url`, as the Docker entrypoint does. */
async function migrateCommand(url: string | undefined, ...argv: string[]) {
  let out = ''
  let err = ''
  const code = await run(['migrate', ...argv], {
    env: url === undefined ? {} : { DATABASE_URL: url },
    home: '/nowhere',
    fetch: () => Promise.reject(new Error('migrate never calls a Hub')),
    stdout: (text) => {
      out += String(text)
    },
    stderr: (text) => {
      err += text
    },
  })
  return { code, out, err }
}

describe('embertrail migrate', () => {
  it('needs a database', async () => {
    const { code, err } = await migrateCommand(undefined)
    expect(code).toBe(2)
    expect(err).toContain('DATABASE_URL')
  })

  describe.skipIf(skipWithoutPostgres)('on Postgres 17', () => {
    it('migrates, is idempotent, and refuses a database that is ahead', async () => {
      const database = await tempDatabase(databaseUrl)
      try {
        const first = await migrateCommand(database.url)
        expect(first).toMatchObject({ code: 0, err: '' })
        expect(first.out).toContain('Applied')
        expect(first.out).toContain('0000_roles')

        const second = await migrateCommand(undefined, '--database-url', database.url)
        expect(second).toEqual({ code: 0, out: 'The database is up to date.\n', err: '' })

        await database.exec(
          `insert into core.migrations (schema, id) values ('store', '9999_from_the_future')`,
        )
        const ahead = await migrateCommand(database.url)
        expect(ahead.code).toBe(1)
        expect(ahead.err).toMatch(/migrations ahead.*9999_from_the_future/)
        expect(ahead.err).toContain('upgrade')
        expect(ahead.err).not.toContain(database.url)
      } finally {
        await database.drop()
      }
    })
  })
})
