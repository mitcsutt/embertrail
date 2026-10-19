// The aggregate shared by `/metrics/query` and `/events/query`: filter, group on up to three
// dimensions, bucket in the request's zone, order, and refuse more than 10,000 rows.

import { HubError } from '@mitcsutt/embertrail-hub'
import type { ScopedDb } from '@mitcsutt/embertrail-hub'
import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

import { condition, dimension, labelsJoin } from './dimensions'
import { rows } from './sql'
import type { Filter, Signal } from './dimensions'
import { checkTz, inZone } from './time'
import type { Bucket } from './time'

/** Aggregate results hold at most this many rows; more is `too-many-rows`. */
export const maxRows = 10_000

export interface Window {
  from: string
  to: string
  tz: string
  filter?: Filter[] | undefined
}

export interface AggregateRequest extends Window {
  bucket?: Bucket | undefined
  group_by?: string[] | undefined
  order?:
    { by?: 'bucket' | 'value' | undefined; direction?: 'asc' | 'desc' | undefined } | undefined
  limit?: number | undefined
}

export interface AggregateRow {
  bucket?: string
  group: Record<string, string | number | boolean | null>
  value: number | null
}

/** The `where` for a window: the time range and every filter, ANDed. */
export function windowWhere(signal: Signal, window: Window) {
  checkTz(window.tz)
  const conditions = (window.filter ?? []).map((f) => condition(signal, f))
  const where = sql.join(
    [
      sql`t.time >= ${window.from}::timestamptz`,
      sql`t.time < ${window.to}::timestamptz`,
      ...conditions.map((c) => c.where),
    ],
    sql` and `,
  )
  return { where, labels: conditions.some((c) => c.labels) }
}

export interface Source {
  /** The rows to aggregate, aliased `t`. */
  from: SQL
  /** The aggregate over `t`, as double precision. */
  value: SQL
  /** `value` reads the Session's Labels. */
  labels?: boolean
}

export async function aggregate(
  db: ScopedDb,
  signal: Signal,
  request: AggregateRequest,
  source: Source,
): Promise<AggregateRow[]> {
  const window = windowWhere(signal, request)
  const keys = request.group_by ?? []
  const dims = keys.map((key) => dimension(signal, key))
  const labels = window.labels || source.labels === true || dims.some((d) => d.labels)
  const bucket =
    request.bucket === undefined
      ? undefined
      : sql`date_trunc(${request.bucket}, t.time, ${request.tz})`
  const selected = [
    bucket === undefined
      ? sql`null::text as bucket`
      : sql`to_char(${bucket} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as bucket`,
    sql`(${source.value})::double precision as value`,
    sql`count(*)::double precision as n`,
    ...dims.map((d, i) => sql`${d.json} as ${sql.raw(`g${String(i)}`)}`),
  ]
  // By position: a repeated expression gets new parameters, so Postgres can't match it.
  const grouping = [
    ...(bucket === undefined ? [] : [sql.raw('1')]),
    ...dims.map((_, i) => sql.raw(String(i + 4))),
  ]
  const groups = dims.map((_, i) => sql.raw(`g${String(i)} asc nulls last`))
  const direction = sql.raw(request.order?.direction === 'desc' ? 'desc' : 'asc')
  const byBucket = bucket === undefined ? [] : [sql`bucket ${direction}`]
  const order =
    request.order?.by === 'value'
      ? [sql`value ${direction} nulls last`, ...byBucket, ...groups]
      : [...byBucket, ...groups]
  // Top-N asks for its own limit; otherwise one row past the cap tells us it was exceeded.
  const limit = request.limit ?? maxRows + 1
  const query = sql`select ${sql.join(selected, sql`, `)}
    from ${source.from} t ${labels ? labelsJoin : sql``}
    where ${window.where}
    ${grouping.length === 0 ? sql`` : sql`group by ${sql.join(grouping, sql`, `)}`}
    ${order.length === 0 ? sql`` : sql`order by ${sql.join(order, sql`, `)}`}
    limit ${limit}`
  const found = await rows<
    Record<string, unknown> & { bucket: string | null; value: number | null; n: number }
  >(db, query)
  if (request.limit === undefined && found.length > maxRows) {
    throw HubError.tooManyRows(
      `The query would return more than ${String(maxRows)} rows; narrow it, bucket it coarser or set a limit`,
    )
  }
  // An ungrouped aggregate over no rows still yields one row; an empty range has none.
  return found
    .filter((row) => row.n > 0)
    .map((row) => ({
      ...(row.bucket === null ? {} : { bucket: inZone(new Date(row.bucket), request.tz) }),
      group: Object.fromEntries(
        keys.map((key, i) => [
          key,
          (row[`g${String(i)}`] ?? null) as string | number | boolean | null,
        ]),
      ),
      value: row.value,
    }))
}
