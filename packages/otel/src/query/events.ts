// `POST /api/v1/events/query`: Events one by one (`list`, cursor-paginated) or aggregated
// (`aggregate`, grouped and bucketed like Metrics).

import { HubError } from '@mitcsutt/embertrail-hub'
import type { ScopedDb } from '@mitcsutt/embertrail-hub'
import { sql } from 'drizzle-orm'
import { z } from 'zod'

import { sha256 } from '../otlp'
import type { Attributes } from '../otlp'
import { aggregate, windowWhere } from './aggregate'
import { dimension, labelsJoin } from './dimensions'
import type { eventsAggregateQuery, eventsListQuery } from './schemas'
import { rows, withoutPaging } from './sql'

type ListQuery = z.output<typeof eventsListQuery>
type AggregateQuery = z.output<typeof eventsAggregateQuery>

const percentiles = { p50: 0.5, p90: 0.9, p95: 0.95, p99: 0.99 } as const

export async function aggregateEvents(db: ScopedDb, query: AggregateQuery) {
  const { fn, key } = query.aggregation
  const d = key === undefined ? undefined : dimension('event', key)
  const value = (() => {
    if (fn === 'count' || d === undefined) return sql`count(*)`
    if (fn === 'count_distinct') return sql`count(distinct ${d.text})`
    if (fn in percentiles) {
      const p = percentiles[fn as keyof typeof percentiles]
      return sql`percentile_cont(${p}::double precision) within group (order by ${d.number})`
    }
    return sql`${sql.raw(fn)}(${d.number})`
  })()
  const rows = await aggregate(db, 'event', query, {
    from: sql`otel.otel_logs`,
    value,
    labels: d?.labels === true,
  })
  return {
    rows,
    meta: {
      tz: query.tz,
      ...(query.bucket === undefined ? {} : { bucket: query.bucket }),
      unit: null,
    },
  }
}

/** Where a page ended: the last Event's time (exact, as text), sequence and id. */
const cursorShape = z.tuple([z.string(), z.string(), z.number(), z.string()])

/** Fingerprints the query, so a cursor only works with the query that issued it. */
async function fingerprint(query: ListQuery) {
  return (await sha256(JSON.stringify(withoutPaging(query)))).slice(0, 16)
}

function encode(parts: z.infer<typeof cursorShape>) {
  return btoa(JSON.stringify(parts)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function decode(raw: string, expected: string) {
  let parsed: unknown
  try {
    parsed = JSON.parse(atob(raw.replaceAll('-', '+').replaceAll('_', '/')))
  } catch {
    throw HubError.invalidCursor()
  }
  const result = cursorShape.safeParse(parsed)
  if (!result.success || result.data[0] !== expected) throw HubError.invalidCursor()
  const [, time, sequence, id] = result.data
  return { time, sequence, id }
}

interface EventRow {
  time: string
  event_name: string
  sequence: number | null
  sort_sequence: number
  id: string
  session_id: string | null
  prompt_id: string | null
  request_id: string | null
  model: string | null
  service_name: string
  owner_id: string
  source_id: string
  account_id: string | null
  body: string | null
  attributes: Attributes
  resource: Attributes
}

export async function listEvents(db: ScopedDb, query: ListQuery) {
  const window = windowWhere('event', query)
  const print = await fingerprint(query)
  const after = query.cursor === undefined ? undefined : decode(query.cursor, print)
  const desc = query.order === 'desc'
  // Newest (or oldest) first by time, then `event.sequence`; the id breaks ties.
  const key = sql`(t.time, coalesce(t.event_sequence, -1), t.id)`
  const seek =
    after === undefined
      ? sql``
      : sql`and ${key} ${sql.raw(desc ? '<' : '>')} (${after.time}::timestamptz, ${after.sequence}::bigint, ${after.id}::bigint)`
  const direction = sql.raw(desc ? 'desc' : 'asc')
  const found = await rows<EventRow>(
    db,
    sql`select
      to_char(t.time at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as time,
      t.event_name, t.event_sequence::double precision as sequence,
      coalesce(t.event_sequence, -1)::double precision as sort_sequence, t.id::text as id,
      t.session_id, t.prompt_id, t.request_id, t.model, t.service_name, t.owner_id, t.source_id,
      t.account_id, case when jsonb_typeof(t.body) = 'string' then t.body #>> '{}' end as body,
      t.attributes, t.resource
    from otel.otel_logs t ${window.labels ? labelsJoin : sql``}
    where ${window.where} ${seek}
    order by t.time ${direction}, coalesce(t.event_sequence, -1) ${direction}, t.id ${direction}
    limit ${query.limit + 1}`,
  )
  const page = found.slice(0, query.limit)
  const last = page.at(-1)
  return {
    items: page.map((row) => ({
      time: row.time,
      event_name: row.event_name,
      sequence: row.sequence,
      session_id: row.session_id,
      prompt_id: row.prompt_id,
      request_id: row.request_id,
      model: row.model,
      service_name: row.service_name,
      owner_id: row.owner_id,
      source_id: row.source_id,
      account_id: row.account_id,
      body: row.body,
      attributes: row.attributes,
      resource: row.resource,
    })),
    next_cursor:
      found.length > query.limit && last !== undefined
        ? encode([print, last.time, last.sort_sequence, last.id])
        : null,
  }
}
