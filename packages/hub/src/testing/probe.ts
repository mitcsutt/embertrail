import { integer, serial, text } from 'drizzle-orm/pg-core'
import { z } from 'zod'

import { defineModule, moduleSchema, op } from '../index'

// A fixture Module for the identity tests: it reports who the core resolved, stores Signals
// stamped with the Account their attributes name (so Grants apply), and keeps plain notes
// (no Account, so only their Owner and the Owner's Team read them). Named by the caller, so a
// test can load two and prove a Grant covers exactly one.

const signal = z.object({
  id: z.number(),
  value: z.number(),
  accountId: z.string(),
  ownerId: z.string(),
})
const note = z.object({ id: z.number(), note: z.string(), ownerId: z.string() })

export function probe<N extends string>(name: N) {
  const schema = moduleSchema(name)
  const signals = schema.ownedTable(
    'signals',
    {
      id: serial('id').primaryKey(),
      accountId: text('account_id').notNull(),
      value: integer('value').notNull(),
    },
    { signal: true },
  )
  const notes = schema.ownedTable('notes', {
    id: serial('id').primaryKey(),
    note: text('note').notNull(),
  })
  const toSignal = (row: typeof signals.$inferSelect) => ({
    id: row.id,
    value: row.value,
    accountId: row.accountId,
    ownerId: row.ownerId,
  })
  const toNote = (row: typeof notes.$inferSelect) => ({
    id: row.id,
    note: row.note,
    ownerId: row.ownerId,
  })

  return defineModule({
    contract: 1,
    name,
    tables: { signals, notes },
    migrations: [
      {
        id: '0000_init',
        sql: `create table signals (
  id serial primary key,
  account_id text not null references core.accounts (id) on delete cascade,
  value integer not null
)
--> statement-breakpoint
create table notes (id serial primary key, note text not null)`,
      },
    ],
    ops: {
      whoami: op.query({
        method: 'GET',
        path: `/api/v1/${name}/whoami`,
        summary: 'The caller the core resolved',
        input: z.object({}),
        output: z.object({
          userId: z.string(),
          ownerId: z.string(),
          sourceId: z.string().nullable(),
          scopes: z.array(z.string()),
        }),
        run: (_, { caller }) =>
          Promise.resolve({
            userId: caller.userId,
            ownerId: caller.ownerId,
            sourceId: caller.sourceId ?? null,
            scopes: [...caller.scopes],
          }),
      }),
      ingest: op.ingest({
        path: `/api/v1/${name}/signals`,
        summary: 'Ingest a Signal, stamped with the Account its attributes name',
        input: z.object({
          value: z.number().int(),
          attributes: z.record(z.string(), z.string()).default({}),
        }),
        output: signal,
        async run(input, { db, account }) {
          const accountId = await account(input.attributes)
          const [row] = await db
            .insert(signals)
            .values({ accountId, value: input.value })
            .returning()
          if (row === undefined) throw new Error('insert returned nothing')
          return toSignal(row)
        },
      }),
      forgeAccount: op.ingest({
        path: `/api/v1/${name}/forged-signals`,
        summary: 'Ingest a Signal naming any Account (the database must refuse another User’s)',
        input: z.object({ value: z.number().int(), accountId: z.string() }),
        output: signal,
        async run(input, { db }) {
          const [row] = await db.insert(signals).values(input).returning()
          if (row === undefined) throw new Error('insert returned nothing')
          return toSignal(row)
        },
      }),
      signals: op.query({
        method: 'GET',
        path: `/api/v1/${name}/signals`,
        summary: 'Every Signal the caller can read',
        input: z.object({}),
        output: z.object({ signals: z.array(signal) }),
        async run(_, { db }) {
          const found = await db.select().from(signals).orderBy(signals.id)
          return { signals: found.map(toSignal) }
        },
      }),
      addNote: op.mutate({
        method: 'POST',
        path: `/api/v1/${name}/notes`,
        summary: 'Add a note',
        input: z.object({ note: z.string().min(1) }),
        output: note,
        async run(input, { db }) {
          const [row] = await db.insert(notes).values({ note: input.note }).returning()
          if (row === undefined) throw new Error('insert returned nothing')
          return toNote(row)
        },
      }),
      notes: op.query({
        method: 'GET',
        path: `/api/v1/${name}/notes`,
        summary: 'Every note the caller can read',
        input: z.object({}),
        output: z.object({ notes: z.array(note) }),
        async run(_, { db }) {
          const found = await db.select().from(notes).orderBy(notes.id)
          return { notes: found.map(toNote) }
        },
      }),
    },
  })
}
