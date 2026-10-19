// The store Module (#35): namespaced JSON documents for apps such as the Dashboard. It is
// written only against the Module contract: the core does auth, Scopes, ownership, row-level
// security, OpenAPI, export and delete, so none of that appears here.

import { defineModule, HubError, moduleSchema, op, reply } from '@mitcsutt/embertrail-hub'
import type { Ctx, OwnerRef } from '@mitcsutt/embertrail-hub'
import { and, desc, eq, sql } from 'drizzle-orm'
import { integer, jsonb, text, timestamp } from 'drizzle-orm/pg-core'
import { z } from 'zod'

/** A document's `data`, serialised, may be at most 1 MiB. */
export const maxDataBytes = 1_048_576

const schema = moduleSchema('store')

export const documentsTable = schema.ownedTable('documents', {
  namespace: text('namespace').notNull(),
  id: text('id').notNull(),
  version: integer('version').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  data: jsonb('data').notNull(),
})

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)

const storeDocument = z.object({
  namespace: slug,
  id: slug,
  owner: z.object({ kind: z.enum(['user', 'team']), id: z.string() }),
  version: z.int().min(1),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
  data: z.json(),
})

type StoreDocument = z.input<typeof storeDocument>

// `data` is read back as text and parsed here: drivers and Drizzle disagree on JSON strings
// that look like other JSON values ("123"), and text round-trips exactly.
const columns = {
  namespace: documentsTable.namespace,
  id: documentsTable.id,
  ownerId: documentsTable.ownerId,
  version: documentsTable.version,
  createdAt: documentsTable.createdAt,
  updatedAt: documentsTable.updatedAt,
  data: sql<string>`${documentsTable.data}::text`,
}

interface Row {
  namespace: string
  id: string
  ownerId: string
  version: number
  createdAt: Date
  updatedAt: Date
  data: string
}

async function toDocument(row: Row, ownerOf: (id: string) => Promise<OwnerRef>) {
  return {
    namespace: row.namespace,
    id: row.id,
    owner: await ownerOf(row.ownerId),
    version: row.version,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    data: JSON.parse(row.data) as StoreDocument['data'],
  }
}

/** Strong, and changes when a deleted id is created again, so a stale `If-Match` can't match. */
function etagOf(row: Row) {
  return `"${row.createdAt.getTime().toString(36)}.${String(row.version)}"`
}

/** RFC 9110 strong comparison against an `If-Match` list. */
function ifMatchHolds(header: string, row: Row) {
  const etag = etagOf(row)
  return header.split(',').some((tag) => ['*', etag].includes(tag.trim()))
}

const where = (namespace: string, id: string) =>
  and(eq(documentsTable.namespace, namespace), eq(documentsTable.id, id))

async function find(db: Ctx['db'], namespace: string, id: string): Promise<Row | undefined> {
  const [row] = await db.select(columns).from(documentsTable).where(where(namespace, id))
  return row
}

/**
 * A write that matched no row although the read found one: the document changed or went
 * away meanwhile, or row-level security lets the caller read it but not write it.
 */
async function refusedWrite(db: Ctx['db'], namespace: string, id: string, ifMatch?: string) {
  const now = await find(db, namespace, id)
  if (now !== undefined && (ifMatch === undefined || ifMatchHolds(ifMatch, now))) {
    return HubError.forbidden('This document can be read here but not written')
  }
  return ifMatch === undefined ? HubError.notFound() : HubError.preconditionFailed()
}

interface Cursor {
  namespace: string
  updatedAt: string
  id: string
}

function encodeCursor(cursor: Cursor) {
  return btoa(JSON.stringify([cursor.namespace, cursor.updatedAt, cursor.id]))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

const cursorShape = z.tuple([z.string(), z.iso.datetime({ offset: true }), z.string()])

function decodeCursor(raw: string, namespace: string): Cursor {
  let parsed: unknown
  try {
    parsed = JSON.parse(atob(raw.replaceAll('-', '+').replaceAll('_', '/')))
  } catch {
    throw HubError.invalidCursor()
  }
  const result = cursorShape.safeParse(parsed)
  if (!result.success || result.data[0] !== namespace) throw HubError.invalidCursor()
  const [, updatedAt, id] = result.data
  return { namespace, updatedAt, id }
}

const ifMatch = z.string().min(1).max(1024).optional()

export const store = defineModule({
  contract: 1,
  name: 'store',
  tables: { documents: documentsTable },
  migrations: [
    {
      id: '0000_init',
      // The id is unique per namespace across every Owner, so a hidden holder is a 409.
      sql: `create table documents (
  namespace text not null,
  id text not null,
  version integer not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  data jsonb not null,
  primary key (namespace, id)
)
--> statement-breakpoint
create index documents_recent_idx on documents (namespace, updated_at desc, id desc)`,
    },
  ],
  ops: {
    list: op.query({
      method: 'GET',
      path: '/api/v1/store/{namespace}',
      summary: 'List documents in a namespace, most recently updated first',
      input: z.object({
        namespace: slug,
        cursor: z.string().max(1024).optional(),
        limit: z.coerce.number().int().min(1).max(1000).default(100),
      }),
      output: z.object({ items: z.array(storeDocument), next_cursor: z.string().nullable() }),
      async run({ namespace, cursor, limit }, { db, ownerOf }) {
        const after = cursor === undefined ? undefined : decodeCursor(cursor, namespace)
        const rows = await db
          .select(columns)
          .from(documentsTable)
          .where(
            and(
              eq(documentsTable.namespace, namespace),
              after === undefined
                ? undefined
                : sql`(${documentsTable.updatedAt}, ${documentsTable.id}) < (${after.updatedAt}::timestamptz, ${after.id})`,
            ),
          )
          .orderBy(desc(documentsTable.updatedAt), desc(documentsTable.id))
          .limit(limit + 1)
        const page = rows.slice(0, limit)
        const last = page.at(-1)
        return {
          items: await Promise.all(page.map((row) => toDocument(row, ownerOf))),
          next_cursor:
            rows.length > limit && last !== undefined
              ? encodeCursor({ namespace, updatedAt: last.updatedAt.toISOString(), id: last.id })
              : null,
        }
      },
    }),
    get: op.query({
      method: 'GET',
      path: '/api/v1/store/{namespace}/{id}',
      summary: 'One document; `ETag` carries its version',
      input: z.object({ namespace: slug, id: slug }),
      output: storeDocument,
      etag: true,
      async run({ namespace, id }, { db, ownerOf }) {
        const row = await find(db, namespace, id)
        if (row === undefined) throw HubError.notFound()
        return reply(await toDocument(row, ownerOf), { etag: etagOf(row) })
      },
    }),
    put: op.mutate({
      method: 'PUT',
      path: '/api/v1/store/{namespace}/{id}',
      summary: 'Create or replace a document; `If-Match` replaces only an unchanged one',
      input: z.strictObject({
        namespace: slug,
        id: slug,
        data: z.json(),
        if_match: ifMatch,
        if_none_match: z.literal('*').optional(),
        owner: z.string().max(1024).optional(),
      }),
      headers: { if_match: 'If-Match', if_none_match: 'If-None-Match', owner: 'Embertrail-Owner' },
      statuses: [200, 201],
      etag: true,
      output: storeDocument,
      async run(input, { db, now, ownerOf }) {
        if (input.owner !== undefined) {
          throw HubError.invalid('Team Owners arrive with core identity (#29)')
        }
        const { namespace, id } = input
        const serialised = JSON.stringify(input.data)
        if (new TextEncoder().encode(serialised).byteLength > maxDataBytes) {
          throw HubError.payloadTooLarge(`data is over ${String(maxDataBytes)} bytes serialised`)
        }
        const data = sql`${serialised}::jsonb`
        let existing = await find(db, namespace, id)
        if (existing === undefined) {
          if (input.if_match !== undefined) throw HubError.preconditionFailed()
          const [created] = await db
            .insert(documentsTable)
            .values({ namespace, id, version: 1, createdAt: now(), updatedAt: now(), data })
            .onConflictDoNothing()
            .returning(columns)
          if (created !== undefined) {
            return reply(await toDocument(created, ownerOf), { status: 201, etag: etagOf(created) })
          }
          // Taken since the read, or held all along by a document the caller can't see.
          existing = await find(db, namespace, id)
          if (existing === undefined) throw HubError.conflict('The id is taken')
        }
        if (input.if_none_match !== undefined) throw HubError.preconditionFailed()
        if (input.if_match !== undefined && !ifMatchHolds(input.if_match, existing)) {
          throw HubError.preconditionFailed()
        }
        const [replaced] = await db
          .update(documentsTable)
          .set({ data, version: sql`${documentsTable.version} + 1`, updatedAt: now() })
          .where(
            and(
              where(namespace, id),
              input.if_match === undefined
                ? undefined
                : eq(documentsTable.version, existing.version),
            ),
          )
          .returning(columns)
        if (replaced === undefined) throw await refusedWrite(db, namespace, id, input.if_match)
        return reply(await toDocument(replaced, ownerOf), { etag: etagOf(replaced) })
      },
    }),
    delete: op.mutate({
      method: 'DELETE',
      path: '/api/v1/store/{namespace}/{id}',
      summary: 'Hard-delete a document; `If-Match` is honoured as on PUT',
      input: z.object({ namespace: slug, id: slug, if_match: ifMatch }),
      headers: { if_match: 'If-Match' },
      statuses: [204],
      output: z.null(),
      async run({ namespace, id, if_match: expected }, { db }) {
        const existing = await find(db, namespace, id)
        if (existing === undefined) throw HubError.notFound()
        if (expected !== undefined && !ifMatchHolds(expected, existing)) {
          throw HubError.preconditionFailed()
        }
        const [deleted] = await db
          .delete(documentsTable)
          .where(
            and(
              where(namespace, id),
              expected === undefined ? undefined : eq(documentsTable.version, existing.version),
            ),
          )
          .returning({ id: documentsTable.id })
        if (deleted === undefined) throw await refusedWrite(db, namespace, id, expected)
        return reply.noContent()
      },
    }),
  },
})
