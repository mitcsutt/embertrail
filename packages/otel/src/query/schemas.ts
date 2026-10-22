// Request and response schemas of the otel Query API, mirroring `spec/query-api.yaml`. The
// core validates input against them (400 `validation`) and parses output through them.

import { z } from 'zod'

import { keyPattern } from './dimensions'
import { buckets } from './time'

export const timestamp = z.iso.datetime({ offset: true })
export const attributeKey = z.string().regex(keyPattern)
const scalar = z.union([z.string(), z.number(), z.boolean()])

export const filter = z.union([
  z.strictObject({
    key: attributeKey,
    op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte']),
    value: scalar,
  }),
  z.strictObject({
    key: attributeKey,
    op: z.enum(['in', 'not_in']),
    value: z.array(scalar).min(1).max(100),
  }),
  z.strictObject({ key: attributeKey, op: z.enum(['exists', 'not_exists']) }),
])

const window = {
  from: timestamp,
  to: timestamp,
  tz: z.string().min(1).max(64),
  filter: z.array(filter).max(20).optional(),
}

const groupBy = z
  .array(attributeKey)
  .max(3, 'group_by takes at most 3 dimensions')
  .refine((keys) => new Set(keys).size === keys.length, 'group_by keys must be unique')
  .optional()

const aggregateOrder = z
  .strictObject({
    by: z.enum(['bucket', 'value']).optional(),
    direction: z.enum(['asc', 'desc']).default('asc'),
  })
  .optional()

const aggregateQuery = {
  ...window,
  bucket: z.enum(buckets).optional(),
  group_by: groupBy,
  order: aggregateOrder,
  limit: z.int().min(1).max(10_000).optional(),
}

export const metricsQuery = z.strictObject({
  ...aggregateQuery,
  metric: z.string().min(1).max(256),
  aggregation: z.enum(['sum', 'avg', 'min', 'max', 'count', 'last']),
})

export const eventsListQuery = z.strictObject({
  ...window,
  mode: z.literal('list'),
  order: z.enum(['desc', 'asc']).default('desc'),
  cursor: z.string().max(1024).optional(),
  limit: z.int().min(1).max(1000).default(100),
})

export const eventsAggregateQuery = z.strictObject({
  ...aggregateQuery,
  mode: z.literal('aggregate'),
  aggregation: z
    .strictObject({
      fn: z.enum([
        'count',
        'count_distinct',
        'sum',
        'avg',
        'min',
        'max',
        'p50',
        'p90',
        'p95',
        'p99',
      ]),
      key: attributeKey.optional(),
    })
    .refine((a) => (a.fn === 'count') === (a.key === undefined), {
      message: '`key` is required for every fn except count, and not allowed for count',
      path: ['key'],
    }),
})

export const eventsQuery = z.discriminatedUnion('mode', [eventsListQuery, eventsAggregateQuery])

const groupValue = z.union([z.string(), z.number(), z.boolean(), z.null()])

export const aggregateResult = z.object({
  rows: z
    .array(
      z.object({
        bucket: timestamp.optional(),
        group: z.record(z.string(), groupValue),
        value: z.number().nullable(),
      }),
    )
    .max(10_000),
  meta: z.object({
    tz: z.string(),
    bucket: z.enum(buckets).optional(),
    unit: z.string().nullable(),
  }),
})

const json = z.json()

export const event = z.object({
  time: timestamp,
  event_name: z.string(),
  sequence: z.int().nullable(),
  session_id: z.string().nullable(),
  prompt_id: z.string().nullable(),
  request_id: z.string().nullable(),
  model: z.string().nullable(),
  service_name: z.string(),
  owner_id: z.string(),
  source_id: z.string(),
  account_id: z.string().nullable(),
  body: z.string().nullable(),
  attributes: z.record(z.string(), json),
  resource: z.record(z.string(), json),
})

export const eventList = z.object({ items: z.array(event), next_cursor: z.string().nullable() })

export const labels = z
  .record(attributeKey, z.string().max(256))
  .refine((l) => Object.keys(l).length <= 32, 'At most 32 labels')

export const sessionId = z.string().min(1).max(128)

export const sessionSummary = z.object({
  id: z.string(),
  service_name: z.string().nullable(),
  owner_id: z.string(),
  source_id: z.string().nullable(),
  account_id: z.string().nullable(),
  started_at: timestamp.nullable(),
  last_seen_at: timestamp.nullable(),
  models: z.array(z.string()),
  cost_usd: z.number().nullable(),
  tokens: z.record(z.string(), z.number()),
  event_counts: z.record(z.string(), z.int()),
  group: z.object({ id: z.string(), kind: z.string().nullable() }).nullable(),
  parent_session_id: z.string().nullable(),
  role: z.string().nullable(),
  labels: z.record(z.string(), z.string()),
})

export const sessionDetail = sessionSummary.extend({
  children: z.array(sessionSummary).max(1000),
})

/** `label=key=value`, repeated; a single one arrives as a string. */
const labelParam = z.preprocess(
  (value) => (typeof value === 'string' ? [value] : value),
  z
    .array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_.\-/]{0,127}=.{0,256}$/))
    .max(10)
    .optional(),
)

export const listSessions = z.strictObject({
  from: timestamp.optional(),
  to: timestamp.optional(),
  source_id: z.string().min(1).max(64).optional(),
  account_id: z.string().min(1).max(64).optional(),
  service_name: z.string().optional(),
  model: z.string().optional(),
  group_id: z.string().optional(),
  parent_session_id: z.string().optional(),
  label: labelParam,
  sort: z.enum(['-started_at', 'started_at', '-last_seen_at', '-cost_usd']).default('-started_at'),
  cursor: z.string().max(1024).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
})

export const inventory = z.object({
  owners: z.array(z.object({ id: z.string(), kind: z.enum(['user', 'team']), name: z.string() })),
  sources: z.array(z.object({ id: z.string(), name: z.string(), owner_id: z.string() })),
  accounts: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      owner_id: z.string(),
      organization_id: z.string().nullable(),
      account_uuid: z.string().nullable(),
      email: z.string().nullable(),
    }),
  ),
  services: z.array(z.string()),
  models: z.array(z.string()),
  metrics: z.array(
    z.object({
      name: z.string(),
      kind: z.enum(['sum', 'gauge']),
      unit: z.string().nullable(),
      service_name: z.string(),
    }),
  ),
  events: z.array(z.object({ name: z.string(), service_name: z.string() })),
  attributes: z
    .array(
      z.object({ signal: z.enum(['metric', 'event']), key: attributeKey, promoted: z.boolean() }),
    )
    .max(1000),
})
