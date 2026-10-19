// An example Module to copy when writing a new one (docs/writing-a-module.md). A real Module
// lives in its own package and imports from '@mitcsutt/embertrail-hub' instead of '../index'.

import { desc, eq } from 'drizzle-orm'
import { text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { z } from 'zod'

import { defineModule, HubError, moduleSchema, op } from '../index'

// The Module's Postgres schema; its name is also the Module's name and Scope prefix.
const schema = moduleSchema('notes')

// ownedTable adds owner_id: the core stamps it and row-level security enforces it.
export const notesTable = schema.ownedTable('notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
})

const note = z.object({
  id: z.uuid(),
  title: z.string(),
  body: z.string(),
  created_at: z.iso.datetime({ offset: true }),
})

function toNote(row: typeof notesTable.$inferSelect): z.input<typeof note> {
  return { id: row.id, title: row.title, body: row.body, created_at: row.createdAt.toISOString() }
}

export const notes = defineModule({
  contract: 1,
  name: 'notes',
  tables: { notes: notesTable },
  // Unqualified names land in the Module's schema; the core adds owner_id and its policies.
  migrations: [
    {
      id: '0000_init',
      sql: `create table notes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null default '',
  created_at timestamptz not null
)`,
    },
  ],
  // Swept after RETENTION_DAYS; omit to keep rows forever.
  retention: { column: 'created_at' },
  ops: {
    list: op.query({
      method: 'GET',
      path: '/api/v1/notes',
      summary: 'List the caller’s notes, newest first',
      input: z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }),
      output: z.object({ notes: z.array(note) }),
      // Row-level security already limits rows to the caller: no owner filter needed.
      async run({ limit }, { db }) {
        const rows = await db
          .select()
          .from(notesTable)
          .orderBy(desc(notesTable.createdAt))
          .limit(limit)
        return { notes: rows.map(toNote) }
      },
    }),
    get: op.query({
      method: 'GET',
      path: '/api/v1/notes/{id}',
      summary: 'One note',
      input: z.object({ id: z.uuid() }),
      output: note,
      async run({ id }, { db }) {
        const [row] = await db.select().from(notesTable).where(eq(notesTable.id, id))
        // Another Owner's note is hidden by row-level security, so it is a 404 too.
        if (row === undefined) throw HubError.notFound()
        return toNote(row)
      },
    }),
    create: op.mutate({
      method: 'POST',
      path: '/api/v1/notes',
      summary: 'Create a note',
      input: z.object({
        title: z.string().min(1).max(200),
        body: z.string().max(10_000).default(''),
      }),
      output: note,
      async run({ title, body }, { db, now }) {
        const [row] = await db
          .insert(notesTable)
          .values({ title, body, createdAt: now() })
          .returning()
        if (row === undefined) throw new Error('insert returned no row')
        return toNote(row)
      },
    }),
    delete: op.mutate({
      method: 'DELETE',
      path: '/api/v1/notes/{id}',
      summary: 'Delete a note',
      input: z.object({ id: z.uuid() }),
      output: z.object({ id: z.uuid() }),
      async run({ id }, { db }) {
        const [row] = await db
          .delete(notesTable)
          .where(eq(notesTable.id, id))
          .returning({ id: notesTable.id })
        if (row === undefined) throw HubError.notFound()
        return row
      },
    }),
  },
})
