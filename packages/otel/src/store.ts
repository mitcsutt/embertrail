// Writes mapped rows: one batched `INSERT … SELECT FROM unnest(…) ON CONFLICT DO NOTHING` per
// table per request, so a duplicate is skipped without failing the batch.

import type { ScopedDb } from '@mitcsutt/embertrail-hub'
import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

import type { LogRow, MetricRow, SumRow } from './map'
import { logs, metricsGauge, metricsSum } from './schema'

interface Column<R> {
  name: string
  type: string
  value: (row: R) => unknown
}

const json = (value: unknown) => (value === null ? null : JSON.stringify(value))

function promoted<R extends LogRow | MetricRow>(): Column<R>[] {
  return [
    { name: 'time', type: 'timestamptz', value: (r) => r.time },
    { name: 'service_name', type: 'text', value: (r) => r.serviceName },
    { name: 'session_id', type: 'text', value: (r) => r.sessionId },
    { name: 'account_id', type: 'text', value: (r) => r.accountId },
    { name: 'group_id', type: 'text', value: (r) => r.groupId },
    { name: 'group_kind', type: 'text', value: (r) => r.groupKind },
    { name: 'parent_session_id', type: 'text', value: (r) => r.parentSessionId },
    { name: 'role', type: 'text', value: (r) => r.role },
    { name: 'model', type: 'text', value: (r) => r.model },
    { name: 'scope_name', type: 'text', value: (r) => r.scopeName },
    { name: 'scope_version', type: 'text', value: (r) => r.scopeVersion },
    { name: 'attributes', type: 'jsonb', value: (r) => json(r.attributes) },
    { name: 'resource', type: 'jsonb', value: (r) => json(r.resource) },
  ]
}

const logColumns: Column<LogRow>[] = [
  ...promoted<LogRow>(),
  { name: 'observed_time', type: 'timestamptz', value: (r) => r.observedTime },
  { name: 'event_name', type: 'text', value: (r) => r.eventName },
  { name: 'event_sequence', type: 'bigint', value: (r) => r.eventSequence },
  { name: 'prompt_id', type: 'text', value: (r) => r.promptId },
  { name: 'request_id', type: 'text', value: (r) => r.requestId },
  { name: 'severity_number', type: 'integer', value: (r) => r.severityNumber },
  { name: 'severity_text', type: 'text', value: (r) => r.severityText },
  { name: 'body', type: 'jsonb', value: (r) => json(r.body) },
  { name: 'trace_id', type: 'text', value: (r) => r.traceId },
  { name: 'span_id', type: 'text', value: (r) => r.spanId },
  { name: 'content_hash', type: 'text', value: (r) => r.contentHash },
]

function metricColumns<R extends MetricRow>(): Column<R>[] {
  return [
    ...promoted<R>(),
    { name: 'start_time', type: 'timestamptz', value: (r) => r.startTime },
    { name: 'metric_name', type: 'text', value: (r) => r.metricName },
    { name: 'description', type: 'text', value: (r) => r.description },
    { name: 'unit', type: 'text', value: (r) => r.unit },
    { name: 'value', type: 'double precision', value: (r) => r.value },
    { name: 'type', type: 'text', value: (r) => r.type },
    { name: 'attributes_hash', type: 'text', value: (r) => r.attributesHash },
  ]
}

const sumColumns: Column<SumRow>[] = [
  ...metricColumns<SumRow>(),
  { name: 'is_monotonic', type: 'boolean', value: (r) => r.isMonotonic },
]

/** One statement for the whole batch; `owner_id` and `source_id` come from their defaults. */
async function insert<R>(db: ScopedDb, table: SQL | object, columns: Column<R>[], rows: R[]) {
  if (rows.length === 0) return
  const names = sql.raw(columns.map((c) => `"${c.name}"`).join(', '))
  const arrays = sql.join(
    columns.map((c) => sql`${sql.param(rows.map(c.value))}::${sql.raw(c.type)}[]`),
    sql`, `,
  )
  await db.execute(
    sql`insert into ${table} (${names}) select * from unnest(${arrays}) on conflict do nothing`,
  )
}

export async function storeLogs(db: ScopedDb, rows: LogRow[]) {
  await insert(db, logs, logColumns, rows)
}

export async function storeMetrics(db: ScopedDb, rows: { sums: SumRow[]; gauges: MetricRow[] }) {
  await insert(db, metricsSum, sumColumns, rows.sums)
  await insert(db, metricsGauge, metricColumns<MetricRow>(), rows.gauges)
}
