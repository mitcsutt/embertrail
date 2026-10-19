// `GET /api/v1/sessions` and `GET /api/v1/sessions/{session_id}`: one summary per Owner and
// `session.id`, built from its Signals and its Labels. A Session known only from Labels has
// no Signal fields. Reserved `embertrail.*` Labels override the matching attribute.

import { HubError } from '@mitcsutt/embertrail-hub'
import type { ScopedDb } from '@mitcsutt/embertrail-hub'
import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { z } from 'zod'

import { sha256 } from '../otlp'
import type { listSessions, sessionSummary } from './schemas'
import { rows, withoutPaging } from './sql'

type Summary = z.output<typeof sessionSummary>

const costMetric = 'claude_code.cost.usage'
const tokenMetric = 'claude_code.token.usage'

const signalColumns = sql.raw(`owner_id, session_id, source_id, account_id, service_name, model,
  group_id, group_kind, parent_session_id, role, time`)

const rfc3339 = (column: string) =>
  sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`)

/** Every Session's summary columns, effective links included, as the relation `s`. */
const sessions = sql`(
  with signals as (
    select ${signalColumns} from otel.otel_logs where session_id is not null
    union all select ${signalColumns} from otel.otel_metrics_sum where session_id is not null
    union all select ${signalColumns} from otel.otel_metrics_gauge where session_id is not null
  ),
  base as (
    select owner_id, session_id, min(service_name) as service_name, min(source_id) as source_id,
      min(account_id) as account_id, min(time) as started_at, max(time) as last_seen_at,
      coalesce(array_agg(distinct model order by model) filter (where model is not null), '{}') as models,
      max(group_id) as group_id, max(group_kind) as group_kind,
      max(parent_session_id) as parent_session_id, max(role) as role
    from signals group by owner_id, session_id
  ),
  cost as (
    select owner_id, session_id, sum(value) as cost_usd from otel.otel_metrics_sum
    where metric_name = ${costMetric} and session_id is not null group by owner_id, session_id
  ),
  tokens as (
    select owner_id, session_id, jsonb_object_agg(type, total) as tokens from (
      select owner_id, session_id, coalesce(type, 'unknown') as type, sum(value) as total
      from otel.otel_metrics_sum where metric_name = ${tokenMetric} and session_id is not null
      group by 1, 2, 3
    ) per_type group by owner_id, session_id
  ),
  events as (
    select owner_id, session_id, jsonb_object_agg(event_name, n) as event_counts from (
      select owner_id, session_id, event_name, count(*)::int as n from otel.otel_logs
      where session_id is not null group by 1, 2, 3
    ) per_name group by owner_id, session_id
  )
  select coalesce(b.owner_id, l.owner_id) as owner_id, coalesce(b.session_id, l.session_id) as id,
    b.service_name, b.source_id, b.account_id, b.started_at, b.last_seen_at,
    coalesce(b.models, '{}') as models, c.cost_usd, coalesce(k.tokens, '{}') as tokens,
    coalesce(e.event_counts, '{}') as event_counts,
    coalesce(l.labels ->> 'embertrail.group.id', b.group_id) as group_id,
    coalesce(l.labels ->> 'embertrail.group.kind', b.group_kind) as group_kind,
    coalesce(l.labels ->> 'embertrail.parent.session_id', b.parent_session_id) as parent_session_id,
    coalesce(l.labels ->> 'embertrail.role', b.role) as role,
    coalesce(l.labels, '{}') as labels
  from base b
  full join otel.session_labels l on l.owner_id = b.owner_id and l.session_id = b.session_id
  left join cost c on c.owner_id = b.owner_id and c.session_id = b.session_id
  left join tokens k on k.owner_id = b.owner_id and k.session_id = b.session_id
  left join events e on e.owner_id = b.owner_id and e.session_id = b.session_id
) s`

interface Row {
  id: string
  owner_id: string
  service_name: string | null
  source_id: string | null
  account_id: string | null
  started_at: string | null
  last_seen_at: string | null
  models: string[]
  cost_usd: number | null
  tokens: Record<string, number>
  event_counts: Record<string, number>
  group_id: string | null
  group_kind: string | null
  parent_session_id: string | null
  role: string | null
  labels: Record<string, string>
}

const orders = {
  '-started_at': 's.started_at desc nulls last',
  started_at: 's.started_at asc nulls last',
  '-last_seen_at': 's.last_seen_at desc nulls last',
  '-cost_usd': 's.cost_usd desc nulls last, s.started_at desc nulls last',
} as const

async function select(
  db: ScopedDb,
  where: readonly SQL[],
  order: keyof typeof orders,
  limit: number,
  offset = 0,
): Promise<Summary[]> {
  const found = await rows<Row>(
    db,
    sql`select s.id, s.owner_id, s.service_name, s.source_id,
      s.account_id, ${rfc3339('s.started_at')} as started_at, ${rfc3339('s.last_seen_at')} as last_seen_at,
      s.models, s.cost_usd, s.tokens, s.event_counts, s.group_id, s.group_kind,
      s.parent_session_id, s.role, s.labels
    from ${sessions}
    ${where.length === 0 ? sql`` : sql`where ${sql.join([...where], sql` and `)}`}
    order by ${sql.raw(orders[order])}, s.owner_id, s.id
    limit ${limit} offset ${offset}`,
  )
  return found.map((row) => ({
    id: row.id,
    service_name: row.service_name,
    owner_id: row.owner_id,
    source_id: row.source_id,
    account_id: row.account_id,
    started_at: row.started_at,
    last_seen_at: row.last_seen_at,
    models: row.models,
    cost_usd: row.cost_usd,
    tokens: row.tokens,
    event_counts: row.event_counts,
    group: row.group_id === null ? null : { id: row.group_id, kind: row.group_kind },
    parent_session_id: row.parent_session_id,
    role: row.role,
    labels: row.labels,
  }))
}

/** A page's position, tied to the query that issued it. Opaque to clients. */
const cursorShape = z.tuple([z.string(), z.int().min(0)])

async function fingerprint(query: z.output<typeof listSessions>) {
  return (await sha256(JSON.stringify(withoutPaging(query)))).slice(0, 16)
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
  return result.data[1]
}

const encode = (parts: z.infer<typeof cursorShape>) =>
  btoa(JSON.stringify(parts)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')

export async function listSessionSummaries(db: ScopedDb, query: z.output<typeof listSessions>) {
  const where: SQL[] = []
  if (query.from !== undefined) where.push(sql`s.last_seen_at >= ${query.from}::timestamptz`)
  if (query.to !== undefined) where.push(sql`s.started_at < ${query.to}::timestamptz`)
  if (query.source_id !== undefined) where.push(sql`s.source_id = ${query.source_id}`)
  if (query.account_id !== undefined) where.push(sql`s.account_id = ${query.account_id}`)
  if (query.service_name !== undefined) where.push(sql`s.service_name = ${query.service_name}`)
  if (query.model !== undefined) where.push(sql`${query.model} = any(s.models)`)
  if (query.group_id !== undefined) where.push(sql`s.group_id = ${query.group_id}`)
  if (query.parent_session_id !== undefined) {
    where.push(sql`s.parent_session_id = ${query.parent_session_id}`)
  }
  for (const label of query.label ?? []) {
    const at = label.indexOf('=')
    where.push(sql`s.labels ->> ${label.slice(0, at)}::text = ${label.slice(at + 1)}`)
  }
  const print = await fingerprint(query)
  const offset = query.cursor === undefined ? 0 : decode(query.cursor, print)
  const found = await select(db, where, query.sort, query.limit + 1, offset)
  return {
    items: found.slice(0, query.limit),
    next_cursor: found.length > query.limit ? encode([print, offset + query.limit]) : null,
  }
}

/** One Session with its direct children, oldest first; the caller's own first if several Owners share the id. */
export async function getSession(db: ScopedDb, id: string, ownerId: string) {
  const found = await select(db, [sql`s.id = ${id}`], 'started_at', 1000)
  const session = found.find((s) => s.owner_id === ownerId) ?? found[0]
  if (session === undefined) throw HubError.notFound()
  const children = await select(
    db,
    [sql`s.parent_session_id = ${id}`, sql`s.owner_id = ${session.owner_id}`],
    'started_at',
    1000,
  )
  return { ...session, children }
}
