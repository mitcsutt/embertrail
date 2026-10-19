// `GET /api/v1/inventory`: what exists in the caller's visible Signals, for pickers and for
// labelling ids. Without a range it covers everything stored.

import type { Ctx } from '@mitcsutt/embertrail-hub'
import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

import { isPromoted, keyPattern } from './dimensions'
import { rows } from './sql'

/** Attribute keys are capped at this many, most frequent first. */
const maxKeys = 1000

const tables = ['otel.otel_logs', 'otel.otel_metrics_sum', 'otel.otel_metrics_gauge'] as const

const all = <T>(db: Ctx['db'], query: SQL) => rows<T>(db, query)

export async function inventory(
  { db, caller, ownerOf }: Ctx,
  range: { from?: string | undefined; to?: string | undefined },
) {
  const conditions = [
    ...(range.from === undefined ? [] : [sql`time >= ${range.from}::timestamptz`]),
    ...(range.to === undefined ? [] : [sql`time < ${range.to}::timestamptz`]),
  ]
  const where = conditions.length === 0 ? sql`` : sql`where ${sql.join(conditions, sql` and `)}`
  const columns = sql.raw(`owner_id, source_id, account_id, service_name, model,
    coalesce(attributes ->> 'organization.id', resource ->> 'organization.id') as organization_id,
    coalesce(attributes ->> 'user.account_uuid', resource ->> 'user.account_uuid') as account_uuid,
    coalesce(attributes ->> 'user.email', resource ->> 'user.email') as email`)
  const signals = sql`(${sql.join(
    tables.map((t) => sql`select ${columns} from ${sql.raw(t)} ${where}`),
    sql` union all `,
  )}) t`

  const [sources, accounts, services, models, metrics, events, keys] = await Promise.all([
    all<{ id: string; owner_id: string }>(
      db,
      sql`select distinct source_id as id, owner_id from ${signals} order by 1, 2`,
    ),
    all<{
      id: string
      owner_id: string
      organization_id: string | null
      account_uuid: string | null
      email: string | null
    }>(
      db,
      sql`select account_id as id, owner_id, min(organization_id) as organization_id,
        min(account_uuid) as account_uuid, min(email) as email
        from ${signals} where account_id is not null group by 1, 2 order by 1, 2`,
    ),
    all<{ name: string }>(db, sql`select distinct service_name as name from ${signals} order by 1`),
    all<{ name: string }>(
      db,
      sql`select distinct model as name from ${signals} where model is not null order by 1`,
    ),
    all<{ name: string; kind: 'sum' | 'gauge'; unit: string | null; service_name: string }>(
      db,
      sql`select metric_name as name, kind, case when count(distinct unit) = 1 then nullif(min(unit), '') end as unit,
        service_name from (
          select metric_name, 'sum' as kind, unit, service_name from otel.otel_metrics_sum ${where}
          union all select metric_name, 'gauge', unit, service_name from otel.otel_metrics_gauge ${where}
        ) m group by 1, 2, 4 order by 1, 2, 4`,
    ),
    all<{ name: string; service_name: string }>(
      db,
      sql`select distinct event_name as name, service_name from otel.otel_logs ${where} order by 1, 2`,
    ),
    all<{ signal: 'metric' | 'event'; key: string }>(
      db,
      sql`select signal, key from (
          select 'event' as signal, jsonb_object_keys(attributes) as key from otel.otel_logs ${where}
          union all select 'event', jsonb_object_keys(resource) from otel.otel_logs ${where}
          union all select 'metric', jsonb_object_keys(attributes) from otel.otel_metrics_sum ${where}
          union all select 'metric', jsonb_object_keys(resource) from otel.otel_metrics_sum ${where}
          union all select 'metric', jsonb_object_keys(attributes) from otel.otel_metrics_gauge ${where}
          union all select 'metric', jsonb_object_keys(resource) from otel.otel_metrics_gauge ${where}
        ) k where key ~ ${keyPattern.source}
        group by 1, 2 order by count(*) desc, 1, 2 limit ${maxKeys}`,
    ),
  ])

  // Names arrive with core identity (#29); until then an Owner or Source is named by its id.
  const ownerIds = [...new Set([caller.ownerId, ...sources.map((s) => s.owner_id)])]
  const owners = await Promise.all(
    ownerIds.map(async (id) => ({ ...(await ownerOf(id)), name: id })),
  )
  return {
    owners,
    sources: sources.map((s) => ({ id: s.id, name: s.id, owner_id: s.owner_id })),
    accounts: accounts.map((a) => ({
      ...a,
      // A suggestion from the email domain until the User names the Account (#29).
      label: a.email?.split('@')[1] ?? 'Unknown',
    })),
    services: services.map((s) => s.name),
    models: models.map((m) => m.name),
    metrics,
    events,
    attributes: keys.map((k) => ({ ...k, promoted: isPromoted(k.signal, k.key) })),
  }
}
