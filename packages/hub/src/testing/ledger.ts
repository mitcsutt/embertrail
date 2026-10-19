import { eq } from 'drizzle-orm'
import { integer, serial, text, timestamp } from 'drizzle-orm/pg-core'
import { z } from 'zod'

import { defineModule, HubError, moduleSchema, op } from '../index'

// A fixture Module for the invariant checks. Unlike the example Module, it also does what a
// buggy or hostile Module would: writes another owner_id or source_id, and throws mid-op.

const schema = moduleSchema('ledger')

export const entries = schema.ownedTable('entries', {
  id: serial('id').primaryKey(),
  note: text('note').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const readings = schema.ownedTable(
  'readings',
  { id: serial('id').primaryKey(), value: integer('value').notNull() },
  { signal: true },
)

const entry = z.object({ id: z.number(), note: z.string(), ownerId: z.string() })
const reading = z.object({ id: z.number(), value: z.number(), sourceId: z.string() })
const note = z.object({ note: z.string().min(1) })

export const ledger = defineModule({
  contract: 1,
  name: 'ledger',
  tables: { entries, readings },
  // No owner_id or source_id here: the core's policy sync adds them.
  migrations: [
    {
      id: '0000_init',
      sql: `create table entries (id serial primary key, note text not null, created_at timestamptz not null default now())
--> statement-breakpoint
create table readings (id serial primary key, value integer not null)`,
    },
  ],
  retention: { column: 'created_at' },
  ops: {
    addEntry: op.mutate({
      method: 'POST',
      path: '/api/v1/ledger/entries',
      summary: 'Add an entry',
      input: note,
      output: entry,
      async run(input, { db }) {
        const [row] = await db.insert(entries).values({ note: input.note }).returning()
        if (row === undefined) throw new Error('insert returned nothing')
        return { id: row.id, note: row.note, ownerId: row.ownerId }
      },
    }),
    listEntries: op.query({
      method: 'GET',
      path: '/api/v1/ledger/entries',
      summary: 'List entries',
      input: z.object({}),
      output: z.object({ entries: z.array(entry) }),
      async run(_, { db }) {
        const found = await db.select().from(entries).orderBy(entries.id)
        return { entries: found.map((r) => ({ id: r.id, note: r.note, ownerId: r.ownerId })) }
      },
    }),
    getEntry: op.query({
      method: 'GET',
      path: '/api/v1/ledger/entries/{id}',
      summary: 'One entry',
      input: z.object({ id: z.coerce.number().int() }),
      output: entry,
      async run(input, { db }) {
        const [row] = await db.select().from(entries).where(eq(entries.id, input.id))
        if (row === undefined) throw HubError.notFound()
        return { id: row.id, note: row.note, ownerId: row.ownerId }
      },
    }),
    forgeEntry: op.mutate({
      method: 'POST',
      path: '/api/v1/ledger/forged-entries',
      summary: 'Writes an entry for another Owner (the database must refuse)',
      input: z.object({ note: z.string(), as: z.string() }),
      output: entry,
      async run(input, { db }) {
        const [row] = await db
          .insert(entries)
          .values({ note: input.note, ownerId: input.as })
          .returning()
        if (row === undefined) throw new Error('insert returned nothing')
        return { id: row.id, note: row.note, ownerId: row.ownerId }
      },
    }),
    moveEntry: op.mutate({
      method: 'PATCH',
      path: '/api/v1/ledger/entries/{id}',
      summary: 'Hands an entry to another Owner (the database must refuse)',
      input: z.object({ id: z.coerce.number().int(), to: z.string() }),
      output: z.object({ moved: z.number() }),
      async run(input, { db }) {
        const moved = await db
          .update(entries)
          .set({ ownerId: input.to })
          .where(eq(entries.id, input.id))
          .returning()
        return { moved: moved.length }
      },
    }),
    addReading: op.ingest({
      path: '/api/v1/ledger/readings',
      summary: 'Ingest a reading',
      input: z.object({ value: z.number().int() }),
      output: reading,
      async run(input, { db }) {
        const [row] = await db.insert(readings).values({ value: input.value }).returning()
        if (row === undefined) throw new Error('insert returned nothing')
        return { id: row.id, value: row.value, sourceId: row.sourceId }
      },
    }),
    forgeReading: op.ingest({
      path: '/api/v1/ledger/forged-readings',
      summary: 'Ingests a reading for another Source (the database must refuse)',
      input: z.object({ value: z.number().int(), from: z.string() }),
      output: reading,
      async run(input, { db }) {
        const [row] = await db
          .insert(readings)
          .values({ value: input.value, sourceId: input.from })
          .returning()
        if (row === undefined) throw new Error('insert returned nothing')
        return { id: row.id, value: row.value, sourceId: row.sourceId }
      },
    }),
    rawReading: op.raw({
      method: 'POST',
      path: '/api/v1/ledger/raw-readings',
      summary: 'Ingest a reading from a plain-text body',
      sourceBound: true,
      openapi: {
        requestBody: { content: { 'text/plain': { schema: { type: 'string' } } } },
        responses: { '202': { description: 'Stored' } },
      },
      async run(request, { db }) {
        const value = Number.parseInt(await request.text(), 10)
        if (Number.isNaN(value)) throw HubError.invalid('Body must be an integer')
        await db.insert(readings).values({ value })
        return new Response(null, { status: 202 })
      },
    }),
    failAfterWrite: op.mutate({
      method: 'POST',
      path: '/api/v1/ledger/fail',
      summary: 'Writes, then throws',
      input: note,
      output: entry,
      async run(input, { db }) {
        await db.insert(entries).values({ note: input.note })
        throw new Error('boom')
      },
    }),
    conflictAfterWrite: op.mutate({
      method: 'POST',
      path: '/api/v1/ledger/conflict',
      summary: 'Writes, then reports a conflict',
      input: note,
      output: entry,
      async run(input, { db }) {
        await db.insert(entries).values({ note: input.note })
        throw HubError.conflict('Already taken')
      },
    }),
  },
})

const tangleSchema = moduleSchema('tangle')

export const links = tangleSchema.ownedTable('links', {
  id: serial('id').primaryKey(),
  entryId: integer('entry_id'),
})

/** Breaks schema isolation: its foreign key targets another Module's table. */
export const tangle = defineModule({
  contract: 1,
  name: 'tangle',
  tables: { links },
  dependsOn: ['ledger'],
  migrations: [
    {
      id: '0000_init',
      sql: 'create table links (id serial primary key, entry_id integer references ledger.entries (id))',
    },
  ],
  ops: {},
})

/** The same table without the foreign key, so it migrates; a check adds the key later. */
export const untangled = defineModule({
  ...tangle,
  migrations: [
    { id: '0000_init', sql: 'create table links (id serial primary key, entry_id integer)' },
  ],
})
