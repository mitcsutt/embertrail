import { sql } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { rows } from '../db/port'
import type { DbPort } from '../db/port'
import { coreDirectory } from '../identity/directory'
import type { Directory } from '../identity/directory'
import { migrateModules } from '../hub/create-hub'
import type { Ctx, Module } from '../module/define'
import { HubError } from '../module/errors'
import { ledger } from '../testing/ledger'
import { pgliteDb } from '../testing/pglite'
import type { ClosableDbPort } from '../testing/pglite'
import { lifecycle } from './lifecycle'

// The lifecycle on PGLite with real migrations and real row-level security, never over HTTP.

describe('lifecycle', () => {
  let db: ClosableDbPort | undefined

  afterEach(async () => {
    await db?.close()
    db = undefined
  })

  async function start(
    options: { retentionDays?: number; now?: Date; modules?: readonly Module[] } = {},
  ) {
    const modules = options.modules ?? [ledger]
    const port = pgliteDb()
    db = port
    await migrateModules(port, modules)
    const clock = () => options.now ?? new Date('2026-10-19T00:00:00Z')
    const errors: unknown[] = []
    const subject = lifecycle({
      db: port,
      modules,
      clock,
      retentionDays: options.retentionDays,
      onError: (error) => errors.push(error),
    })
    const directory = coreDirectory({
      db: port,
      scopes: ['ledger:write'],
      modules: ['ledger'],
      allowedEmails: [],
      allowedDomains: [],
      clock,
    })
    const query = <T>(query: ReturnType<typeof sql>) => port.privileged((tx) => rows<T>(tx, query))
    return { db: port, subject, directory, query, errors }
  }

  /** A User with an ingest Token bound to one Source. */
  async function sender(directory: Directory, userId: string, sourceId: string) {
    await directory.createUser({ id: userId, name: userId })
    await directory.createSource(userId, { id: sourceId, name: sourceId })
    await directory.issueToken(userId, { kind: 'ingest', scopes: ['ledger:write'], sourceId })
  }

  const entry = (port: DbPort, ownerId: string, note: string, createdAt = '2026-10-18') =>
    port.privileged((tx) =>
      tx.execute(
        sql`insert into ledger.entries (note, owner_id, created_at) values (${note}, ${ownerId}, ${createdAt})`,
      ),
    )
  const reading = (port: DbPort, ownerId: string, sourceId: string, value: number) =>
    port.privileged((tx) =>
      tx.execute(
        sql`insert into ledger.readings (value, owner_id, source_id) values (${value}, ${ownerId}, ${sourceId})`,
      ),
    )

  describe('runRetention', () => {
    it('sweeps only rows older than retentionDays, across Owners', async () => {
      const t = await start({ retentionDays: 30 })
      await entry(t.db, 'alice', 'new')
      await entry(t.db, 'alice', 'old-alice', '2026-09-01')
      await entry(t.db, 'bob', 'old-bob', '2026-09-01')
      expect(await t.subject.runRetention()).toEqual({ deleted: 2 })
      expect(await t.query(sql`select note from ledger.entries`)).toEqual([{ note: 'new' }])
    })

    it('keeps everything when retentionDays is unset', async () => {
      const t = await start()
      await entry(t.db, 'alice', 'kept', '2000-01-01')
      expect(await t.subject.runRetention()).toEqual({ deleted: 0 })
      expect(await t.query(sql`select note from ledger.entries`)).toHaveLength(1)
    })
  })

  describe('remove', () => {
    it('removes a Source with the Signal rows it sent, and its record', async () => {
      const t = await start()
      await sender(t.directory, 'alice', 'laptop')
      await t.directory.createSource('alice', { id: 'desktop', name: 'desktop' })
      await reading(t.db, 'alice', 'laptop', 1)
      await reading(t.db, 'alice', 'desktop', 2)
      await entry(t.db, 'alice', 'kept')

      expect(await t.subject.remove.source('laptop')).toBe(true)
      expect(await t.query(sql`select source_id from ledger.readings`)).toEqual([
        { source_id: 'desktop' },
      ])
      expect(await t.query(sql`select id from core.sources where id = 'laptop'`)).toEqual([])
      expect(await t.query(sql`select id from core.tokens where source_id = 'laptop'`)).toEqual([])
      expect(await t.query(sql`select note from ledger.entries`)).toHaveLength(1)
      expect(await t.subject.remove.source('laptop')).toBe(false)
    })

    it('removes a User with every row it owns, its record and its Tokens', async () => {
      const t = await start()
      await sender(t.directory, 'alice', 'laptop')
      await t.directory.createUser({ id: 'bob', name: 'bob' })
      await entry(t.db, 'alice', 'a1')
      await entry(t.db, 'alice', 'a2')
      await reading(t.db, 'alice', 'laptop', 1)
      await entry(t.db, 'bob', 'b1')

      expect(await t.subject.remove.user('alice')).toBe(true)
      expect(await t.query(sql`select owner_id from ledger.entries`)).toEqual([{ owner_id: 'bob' }])
      expect(await t.query(sql`select 1 from ledger.readings`)).toEqual([])
      expect(await t.query(sql`select id from core.users where id = 'alice'`)).toEqual([])
      expect(await t.query(sql`select id from core.sources where owner_id = 'alice'`)).toEqual([])
      expect(await t.query(sql`select id from core.tokens where user_id = 'alice'`)).toEqual([])
      expect(await t.subject.remove.user('alice')).toBe(false)
    })

    it('removes a Team with every row it owns, its record and its memberships', async () => {
      const t = await start()
      await t.directory.createUser({ id: 'alice', name: 'alice' })
      await t.directory.createTeam({ id: 'crew', name: 'crew' })
      await t.directory.setTeamMember('crew', 'alice', 'editor')
      await entry(t.db, 'crew', 'shared')
      await entry(t.db, 'alice', 'mine')

      expect(await t.subject.remove.team('crew')).toBe(true)
      expect(await t.query(sql`select owner_id from ledger.entries`)).toEqual([
        { owner_id: 'alice' },
      ])
      expect(await t.query(sql`select id from core.teams`)).toEqual([])
      expect(await t.query(sql`select 1 from core.team_members`)).toEqual([])
      expect(await t.query(sql`select id from core.users where id = 'alice'`)).toHaveLength(1)
      expect(await t.subject.remove.team('crew')).toBe(false)
    })
  })

  describe('exportOwner', () => {
    const text = (stream: ReadableStream<Uint8Array>) => new Response(stream).text()

    it('exports one Owner’s rows of one Module as JSON Lines', async () => {
      const t = await start()
      await entry(t.db, 'alice', 'mine')
      await entry(t.db, 'bob', 'not mine')
      const lines = (await text(t.subject.exportOwner('ledger', 'alice'))).trimEnd().split('\n')
      expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual([
        {
          table: 'entries',
          row: expect.objectContaining({ note: 'mine', owner_id: 'alice' }) as unknown,
        },
      ])
    })

    it.each([500, 501, 1001])('exports %i rows across pages, each exactly once', async (count) => {
      const t = await start()
      await t.query(
        sql`insert into ledger.entries (note, owner_id)
          select 'n' || g, 'alice' from generate_series(1, ${count}::int) g`,
      )
      await entry(t.db, 'bob', 'other')
      const lines = (await text(t.subject.exportOwner('ledger', 'alice'))).trimEnd().split('\n')
      const notes = lines.map((line) => (JSON.parse(line) as { row: { note: string } }).row.note)
      expect(notes).toHaveLength(count)
      expect(new Set(notes).size).toBe(count)
    })

    it('refuses a Module that is not loaded', async () => {
      const t = await start()
      expect(() => t.subject.exportOwner('nowhere', 'alice')).toThrow(HubError)
    })

    describe('transaction', () => {
      let produced = 0
      let released = 0
      const endless: Module = {
        ...ledger,
        async *export(ctx: Ctx) {
          try {
            for (;;) {
              await ctx.db.execute(sql`select 1`)
              produced += 1
              if (produced === 10) throw new Error('export failed')
              yield JSON.stringify({ n: produced })
            }
          } finally {
            released += 1
          }
        },
      }

      const read = async (reader: ReadableStreamDefaultReader<Uint8Array>, count: number) => {
        const decoder = new TextDecoder()
        const lines: string[] = []
        for (let i = 0; i < count; i++) {
          const { value } = await reader.read()
          lines.push(decoder.decode(value))
        }
        return lines
      }

      /** Whether another transaction can still run: PGLite has one connection. */
      const free = async (subject: { db: DbPort }) =>
        subject.db.privileged((tx) => rows(tx, sql`select 1 as ok`))

      async function started() {
        produced = 0
        released = 0
        return start({ modules: [endless] })
      }

      it('is held while the stream is read, reading ahead at most one line', async () => {
        const t = await started()
        const reader = t.subject.exportOwner('ledger', 'alice').getReader()
        expect(await read(reader, 3)).toEqual(['{"n":1}\n', '{"n":2}\n', '{"n":3}\n'])
        expect(produced).toBeLessThanOrEqual(4)
        expect(released).toBe(0)
        await reader.cancel()
      })

      it('is released when the stream is cancelled', async () => {
        const t = await started()
        const reader = t.subject.exportOwner('ledger', 'alice').getReader()
        await read(reader, 1)
        await reader.cancel()
        expect(released).toBe(1)
        expect(await free(t)).toEqual([{ ok: 1 }])
        expect(t.errors).toEqual([])
      })

      it('is released, and the error reported, when the export fails', async () => {
        const t = await started()
        await expect(text(t.subject.exportOwner('ledger', 'alice'))).rejects.toThrow()
        expect(released).toBe(1)
        expect(await free(t)).toEqual([{ ok: 1 }])
        expect(t.errors).toEqual([expect.objectContaining({ message: 'export failed' })])
      })

      it('is released when the stream ends', async () => {
        const t = await start()
        await entry(t.db, 'alice', 'mine')
        await text(t.subject.exportOwner('ledger', 'alice'))
        expect(await free(t)).toEqual([{ ok: 1 }])
      })
    })
  })
})
