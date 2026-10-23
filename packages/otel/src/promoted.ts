// The one table of the otel Module's promoted attributes: which attribute keys are copied into
// columns, how each is read at ingest, and which a Session's Label overrides (ADR-0002,
// ADR-0014). Ingest (`map.ts`), the bulk insert (`store.ts`), the Query API's dimensions and the
// Session query read it. The Drizzle columns in `schema.ts` and the frozen migration SQL are
// checked against it in `promoted.test.ts`. Adding a promoted attribute is a row here plus a
// new migration; the migration SQL is forward-only and never edited.

import type { LogRow, MetricRow, Promoted } from './map'

export type Signal = 'metric' | 'event'

export interface Promotion<Field extends string = string> {
  /** The attribute key a query filters and groups on. */
  key: string
  column: string
  /** Its SQL type, for the bulk insert. */
  type: 'text' | 'bigint'
  /**
   * Where ingest gets the value:
   * - `attributes`: the record's or point's own attribute, else the resource's;
   * - `own`: the own attribute only;
   * - `account`: recognised by the core from other attributes (`ctx.account`);
   * - `record`: a field of the record or metric itself, not an attribute;
   * - `core`: set by the core's defaults, never inserted.
   */
  from: 'attributes' | 'own' | 'account' | 'record' | 'core'
  /** The row field in `map.ts`; absent when `from` is `core`. */
  field?: Field
  /** What a missing value reads as, where the column is not null. */
  fallback?: string
  /** A reserved Label of the same key overrides the column (ADR-0014). */
  labelled?: true
}

export const common: readonly Promotion<keyof Promoted>[] = [
  { key: 'embertrail.owner_id', column: 'owner_id', type: 'text', from: 'core' },
  { key: 'embertrail.source_id', column: 'source_id', type: 'text', from: 'core' },
  {
    key: 'embertrail.account_id',
    column: 'account_id',
    type: 'text',
    from: 'account',
    field: 'accountId',
  },
  {
    key: 'service.name',
    column: 'service_name',
    type: 'text',
    from: 'attributes',
    field: 'serviceName',
    // The OTel default when a sender has no `service.name`.
    fallback: 'unknown_service',
  },
  {
    key: 'session.id',
    column: 'session_id',
    type: 'text',
    from: 'attributes',
    field: 'sessionId',
  },
  {
    key: 'embertrail.group.id',
    column: 'group_id',
    type: 'text',
    from: 'attributes',
    field: 'groupId',
    labelled: true,
  },
  {
    key: 'embertrail.group.kind',
    column: 'group_kind',
    type: 'text',
    from: 'attributes',
    field: 'groupKind',
    labelled: true,
  },
  {
    key: 'embertrail.parent.session_id',
    column: 'parent_session_id',
    type: 'text',
    from: 'attributes',
    field: 'parentSessionId',
    labelled: true,
  },
  {
    key: 'embertrail.role',
    column: 'role',
    type: 'text',
    from: 'attributes',
    field: 'role',
    labelled: true,
  },
  { key: 'model', column: 'model', type: 'text', from: 'attributes', field: 'model' },
]

const metricOnly: readonly Promotion<keyof MetricRow>[] = [
  { key: 'type', column: 'type', type: 'text', from: 'own', field: 'type' },
  { key: 'unit', column: 'unit', type: 'text', from: 'record', field: 'unit' },
]

const eventOnly: readonly Promotion<keyof LogRow>[] = [
  { key: 'event.name', column: 'event_name', type: 'text', from: 'own', field: 'eventName' },
  {
    key: 'event.sequence',
    column: 'event_sequence',
    type: 'bigint',
    from: 'own',
    field: 'eventSequence',
  },
  { key: 'prompt.id', column: 'prompt_id', type: 'text', from: 'own', field: 'promptId' },
  { key: 'request_id', column: 'request_id', type: 'text', from: 'own', field: 'requestId' },
]

/** Promoted on one Signal only. */
export const specific = { metric: metricOnly, event: eventOnly } as const

/** Every promotion of a Signal. */
export const promotions = {
  metric: [...common, ...metricOnly],
  event: [...common, ...eventOnly],
} as const

/** A Signal's promotions where the row type doesn't matter. */
export function promotionsOf(signal: Signal): readonly Promotion[] {
  return promotions[signal]
}

/** The promoted keys a reserved Label overrides, the same for every Signal. */
export const labelled: readonly Promotion<keyof Promoted>[] = common.filter(
  (p) => p.labelled === true,
)

/**
 * Columns of the Signal tables that hold no promoted attribute: the identity, the time, what
 * was sent as is, and each record's own fields. A column is in this list or has a row.
 */
export const unpromoted = {
  shared: ['id', 'time', 'scope_name', 'scope_version', 'attributes', 'resource'],
  event: [
    'observed_time',
    'severity_number',
    'severity_text',
    'body',
    'trace_id',
    'span_id',
    'content_hash',
  ],
  metric: [
    'start_time',
    'metric_name',
    'description',
    'value',
    'attributes_hash',
    // Only `otel_metrics_sum` has it.
    'is_monotonic',
  ],
} as const

/** The key of the reserved Label that overrides this column. */
export function labelKey(column: string): string {
  const found = labelled.find((p) => p.column === column)
  if (found === undefined) throw new Error(`No Label overrides the column "${column}".`)
  return found.key
}
