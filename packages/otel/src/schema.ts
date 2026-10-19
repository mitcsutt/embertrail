// The otel Module's tables: the OpenTelemetry Collector ClickHouse exporter's layout (ADR-0002),
// trimmed to what agents send. Names and attributes are kept as sent, unwrapped to JSONB; hot
// attributes are copied into promoted columns. The core adds owner_id and source_id.

import { moduleSchema } from '@mitcsutt/embertrail-hub'
import type { Migration } from '@mitcsutt/embertrail-hub'
import {
  bigint,
  boolean,
  doublePrecision,
  integer,
  jsonb,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'

import type { Attributes, Json } from './otlp'

export const schema = moduleSchema('otel')

const time = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' })

/** Promoted on every Signal: who, where from, and the Session links (ADR-0014). */
const promoted = () => ({
  time: time('time').notNull(),
  serviceName: text('service_name').notNull(),
  sessionId: text('session_id'),
  accountId: text('account_id'),
  groupId: text('group_id'),
  groupKind: text('group_kind'),
  parentSessionId: text('parent_session_id'),
  role: text('role'),
  model: text('model'),
})

/** Resource, scope and attributes, as sent. */
const sent = () => ({
  scopeName: text('scope_name').notNull(),
  scopeVersion: text('scope_version').notNull(),
  attributes: jsonb('attributes').$type<Attributes>().notNull(),
  resource: jsonb('resource').$type<Attributes>().notNull(),
})

export const logs = schema.ownedTable(
  'otel_logs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    ...promoted(),
    observedTime: time('observed_time'),
    eventName: text('event_name').notNull(),
    eventSequence: bigint('event_sequence', { mode: 'number' }),
    promptId: text('prompt_id'),
    requestId: text('request_id'),
    severityNumber: integer('severity_number'),
    severityText: text('severity_text'),
    body: jsonb('body').$type<Json>(),
    traceId: text('trace_id'),
    spanId: text('span_id'),
    ...sent(),
    contentHash: text('content_hash'),
  },
  { signal: true },
)

const metric = () => ({
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  ...promoted(),
  startTime: time('start_time'),
  metricName: text('metric_name').notNull(),
  description: text('description').notNull(),
  unit: text('unit').notNull(),
  value: doublePrecision('value').notNull(),
  type: text('type'),
  ...sent(),
  attributesHash: text('attributes_hash').notNull(),
})

export const metricsSum = schema.ownedTable(
  'otel_metrics_sum',
  { ...metric(), isMonotonic: boolean('is_monotonic').notNull() },
  { signal: true },
)

export const metricsGauge = schema.ownedTable('otel_metrics_gauge', metric(), { signal: true })

/**
 * A Session's Labels (ADR-0014), one row per Owner and Session. Written by the caller, not a
 * Source, so it isn't a Signal table, and it may exist before the Session's first Signal.
 */
export const sessionLabels = schema.ownedTable('session_labels', {
  sessionId: text('session_id').notNull(),
  labels: jsonb('labels').$type<Record<string, string>>().notNull(),
  updatedAt: time('updated_at').notNull(),
})

const promotedSql = `time timestamptz not null,
  service_name text not null,
  session_id text,
  account_id text,
  group_id text,
  group_kind text,
  parent_session_id text,
  role text,
  model text`

const sentSql = `scope_name text not null,
  scope_version text not null,
  attributes jsonb not null,
  resource jsonb not null`

const metricSql = `id bigint generated always as identity primary key,
  ${promotedSql},
  start_time timestamptz,
  metric_name text not null,
  description text not null,
  unit text not null,
  value double precision not null,
  type text,
  ${sentSql},
  attributes_hash text not null`

// source_id is declared here (the core fixes its default) so the unique keys can include it.
export const migrations: readonly Migration[] = [
  {
    id: '0000_init',
    sql: [
      `create table otel_logs (
  id bigint generated always as identity primary key,
  ${promotedSql},
  observed_time timestamptz,
  event_name text not null,
  event_sequence bigint,
  prompt_id text,
  request_id text,
  severity_number integer,
  severity_text text,
  body jsonb,
  trace_id text,
  span_id text,
  ${sentSql},
  content_hash text,
  source_id text not null
)`,
      // Claude Code's key; NULLs never collide, so other senders fall to content_hash.
      'create unique index otel_logs_event_key on otel_logs (source_id, session_id, event_sequence, event_name)',
      'create unique index otel_logs_content_key on otel_logs (source_id, content_hash)',
      'create index otel_logs_time_idx on otel_logs (time)',
      'create index otel_logs_session_idx on otel_logs (session_id, time)',
      'create index otel_logs_event_name_idx on otel_logs (event_name, time)',
      `create table otel_metrics_sum (
  ${metricSql},
  is_monotonic boolean not null,
  source_id text not null
)`,
      'create unique index otel_metrics_sum_point_key on otel_metrics_sum (source_id, metric_name, attributes_hash, start_time, time) nulls not distinct',
      'create index otel_metrics_sum_name_idx on otel_metrics_sum (metric_name, time)',
      'create index otel_metrics_sum_session_idx on otel_metrics_sum (session_id, time)',
      `create table otel_metrics_gauge (
  ${metricSql},
  source_id text not null
)`,
      'create unique index otel_metrics_gauge_point_key on otel_metrics_gauge (source_id, metric_name, attributes_hash, start_time, time) nulls not distinct',
      'create index otel_metrics_gauge_name_idx on otel_metrics_gauge (metric_name, time)',
      'create index otel_metrics_gauge_session_idx on otel_metrics_gauge (session_id, time)',
    ].join('\n--> statement-breakpoint\n'),
  },
  {
    id: '0001_session_labels',
    // owner_id is declared so the key can include it; the core fixes its default.
    sql: `create table session_labels (
  session_id text not null,
  labels jsonb not null,
  updated_at timestamptz not null,
  owner_id text not null,
  primary key (owner_id, session_id)
)
--> statement-breakpoint
create index session_labels_session_idx on session_labels (session_id)`,
  },
]
