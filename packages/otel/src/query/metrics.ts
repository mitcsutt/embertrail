// `POST /api/v1/metrics/query`: one Metric aggregated over a range, optionally grouped and
// bucketed. Sums are delta increments (ADR-0003), so `sum` over a range is its total.

import type { ScopedDb } from '@mitcsutt/embertrail-hub'
import { sql } from 'drizzle-orm'
import type { z } from 'zod'

import { aggregate } from './aggregate'
import type { metricsQuery } from './schemas'
import { rows } from './sql'

const columns = sql.raw(`time, owner_id, source_id, account_id, service_name, session_id,
  group_id, group_kind, parent_session_id, role, model, type, unit, value, attributes, resource`)

const values = {
  sum: sql`sum(t.value)`,
  avg: sql`avg(t.value)`,
  min: sql`min(t.value)`,
  max: sql`max(t.value)`,
  count: sql`count(*)`,
  last: sql`(array_agg(t.value order by t.time desc))[1]`,
}

export async function queryMetrics(db: ScopedDb, query: z.output<typeof metricsQuery>) {
  // A Metric is a sum or a gauge; reading both keeps the caller from having to know which.
  const from = sql`(select ${columns} from otel.otel_metrics_sum where metric_name = ${query.metric}
    union all select ${columns} from otel.otel_metrics_gauge where metric_name = ${query.metric})`
  const found = await aggregate(db, 'metric', query, { from, value: values[query.aggregation] })
  const units = await rows<{ unit: string }>(
    db,
    sql`select distinct unit from ${from} t
      where t.time >= ${query.from}::timestamptz and t.time < ${query.to}::timestamptz limit 2`,
  )
  const unit = units.length === 1 ? (units[0]?.unit ?? null) : null
  return {
    rows: found,
    meta: {
      tz: query.tz,
      ...(query.bucket === undefined ? {} : { bucket: query.bucket }),
      unit: unit === '' ? null : unit,
    },
  }
}
