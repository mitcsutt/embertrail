import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { z } from 'zod'

import { rows } from '../db/port'
import type { DbPort, ScopedDb } from '../db/port'
import type { Caller } from '../module/define'
import { HubError } from '../module/errors'

/** At most this many rows come back; `truncated` says whether more existed. */
export const sqlRowLimit = 10_000

/** `POST /api/v1/sql`'s body (`SqlRequest` in spec/query-api.yaml). */
export const sqlInput = z.strictObject({
  sql: z.string().min(1).max(20_000),
  params: z
    .array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .max(100)
    .optional(),
})

export type SqlInput = z.infer<typeof sqlInput>

/** `SqlResult` in spec/query-api.yaml. */
export interface SqlResult {
  columns: { name: string; type: string }[]
  rows: unknown[][]
  truncated: boolean
}

interface Field {
  name: string
  dataTypeID: number
}

interface PgType {
  oid: number
  name: string
  category: string
  elem: number
}

const int8 = 20
const numeric = 1700

/** A Postgres error a driver threw, found through Drizzle's wrapping. */
function databaseError(error: unknown): { code: string; message: string } | undefined {
  for (let e: unknown = error; typeof e === 'object' && e !== null; e = (e as Error).cause) {
    const { code, severity, message } = e as {
      code?: unknown
      severity?: unknown
      message?: unknown
    }
    if (
      typeof code === 'string' &&
      /^[0-9A-Z]{5}$/.test(code) &&
      typeof severity === 'string' &&
      typeof message === 'string'
    ) {
      return { code, message }
    }
  }
  return undefined
}

/** Runs one piece of the caller's SQL; the database's refusal is the caller's 422. */
async function callerSql(db: ScopedDb, query: SQL) {
  try {
    const result: unknown = await db.execute(query)
    return result as { rows: Record<string, unknown>[]; fields: Field[] }
  } catch (error) {
    const found = databaseError(error)
    if (found === undefined) throw error
    // 57014 is also a cancel, but the only canceller here is statement_timeout.
    if (found.code === '57014') throw HubError.queryTimeout(found.message)
    throw HubError.sqlError(found.code, found.message)
  }
}

/**
 * The caller's SQL as one subquery, so Postgres itself refuses anything but a single query
 * expression: `INSERT`, DDL, `SET` and a second statement are syntax errors. The caller's
 * parameters keep their numbers through a comment that names each one; the limit is the
 * last, so there is always a parameter and drivers use the extended protocol, which refuses
 * multiple statements however the text is written.
 */
function wrapped(input: SqlInput, select: SQL, alias: SQL, limit: number) {
  const params = input.params ?? []
  const named =
    params.length === 0
      ? sql``
      : sql`/* ${sql.join(
          params.map((p) => sql`${p}`),
          sql` `,
        )} */`
  const text = input.sql.replace(/[\s;]+$/, '')
  return sql`select ${select} from (${named}\n${sql.raw(text)}\n) as q${alias} limit ${limit}`
}

/** One column as JSON, the way the spec serialises it. */
function render(column: string, type: PgType | undefined) {
  const c = sql.raw(`q.${column}`)
  if (type === undefined) return sql`to_json(${c})`
  if (type.oid === int8 || type.oid === numeric) return sql`to_json(${c}::text)`
  if (type.category === 'A' && (type.elem === int8 || type.elem === numeric)) {
    return sql`to_json(${c}::text[])`
  }
  if (type.name === 'timestamptz') {
    // RFC 3339 in UTC, whatever the server's TimeZone; infinity stays a string.
    return sql`case when isfinite(${c}) then to_json(to_char(${c} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) else to_json(${c}::text) end`
  }
  return sql`to_json(${c})`
}

async function types(db: ScopedDb, oids: readonly number[]) {
  if (oids.length === 0) return new Map<number, PgType>()
  const found = await rows<PgType>(
    db,
    sql`select t.oid::int as oid, t.typcategory as category, t.typelem::int as elem,
        case when t.typcategory = 'A' and e.oid is not null then e.typname || '[]' else t.typname::text end as name
      from pg_catalog.pg_type t left join pg_catalog.pg_type e on e.oid = t.typelem
      where t.oid in ${[...new Set(oids)]}`,
  )
  return new Map(found.map((t) => [t.oid, t]))
}

/**
 * Runs one read-only statement for the caller (#34): as the readonly role, in a READ ONLY
 * transaction with a 10 s statement timeout, under the caller's row-level security. SELECT
 * only is the role's grants; the subquery shape and the extended protocol make it one query.
 */
export async function runSql(db: DbPort, caller: Caller, input: SqlInput): Promise<SqlResult> {
  const session = {
    role: 'readonly' as const,
    userId: caller.userId,
    ownerId: caller.ownerId,
    sourceId: caller.sourceId,
  }
  return db.transaction(session, async (scoped) => {
    // Fail closed where migrate couldn't revoke set_config (not a superuser): with it, the
    // caller could rewrite the settings row-level security reads, or leave the role.
    const [guard] = await rows<{ open: boolean }>(
      scoped,
      sql`select has_function_privilege('pg_catalog.set_config(text, text, boolean)', 'execute') as open`,
    )
    if (guard?.open !== false) {
      throw new HubError(
        500,
        'internal',
        'The SQL endpoint is off: the read-only role may call set_config. Run embertrail migrate as a superuser (docs/sql.md).',
      )
    }
    const described = await callerSql(scoped, wrapped(input, sql`*`, sql``, 0))
    const fields = described.fields
    const byOid = await types(
      scoped,
      fields.map((f) => f.dataTypeID),
    )
    const names = fields.map((_, i) => `c${String(i + 1)}`)
    const row =
      names.length === 0
        ? sql`'[]'`
        : sql`array_to_json(array[${sql.join(
            names.map((name, i) => render(name, byOid.get(fields[i]?.dataTypeID ?? 0))),
            sql`, `,
          )}]::json[])::text`
    const alias = names.length === 0 ? sql`` : sql.raw(` (${names.join(', ')})`)
    const result = await callerSql(
      scoped,
      wrapped(input, sql`${row} as row`, alias, sqlRowLimit + 1),
    )
    const found = result.rows.map((r) => JSON.parse(String(r.row)) as unknown[])
    return {
      columns: fields.map((f) => ({
        name: f.name,
        type: byOid.get(f.dataTypeID)?.name ?? String(f.dataTypeID),
      })),
      rows: found.slice(0, sqlRowLimit),
      truncated: found.length > sqlRowLimit,
    }
  })
}
