// Dimensions: the attribute keys a query filters and groups on. A promoted key reads its
// column; any other key reads the record's (or point's) attributes, falling back to the
// resource's. The reserved Session links read the Session's Label first (ADR-0014).
// Every expression assumes the Signal row is aliased `t` and its Labels `l`.

import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

export type Signal = 'metric' | 'event'

/** The spec's `AttributeKey` pattern. */
export const keyPattern = /^[A-Za-z_][A-Za-z0-9_.\-/]{0,127}$/

/** Matches a decimal number in text, so only numeric strings are cast. */
const numeric = String.raw`^\s*-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$`

/** Promoted to a column on every Signal. */
const common: Record<string, string> = {
  'embertrail.owner_id': 'owner_id',
  'embertrail.source_id': 'source_id',
  'embertrail.account_id': 'account_id',
  'service.name': 'service_name',
  'session.id': 'session_id',
  'embertrail.group.id': 'group_id',
  'embertrail.group.kind': 'group_kind',
  'embertrail.parent.session_id': 'parent_session_id',
  'embertrail.role': 'role',
  model: 'model',
}

const promoted: Record<Signal, Record<string, string>> = {
  metric: { ...common, type: 'type', unit: 'unit' },
  event: {
    ...common,
    'event.name': 'event_name',
    'event.sequence': 'event_sequence',
    'prompt.id': 'prompt_id',
    request_id: 'request_id',
  },
}

/** Reserved Labels that override the matching column (ADR-0014). */
export const linkLabels = [
  'embertrail.group.id',
  'embertrail.group.kind',
  'embertrail.parent.session_id',
  'embertrail.role',
] as const

/** Whether a key maps to a column for this Signal. */
export function isPromoted(signal: Signal, key: string) {
  return Object.hasOwn(promoted[signal], key)
}

/** One key's expressions: as text, as a JSON value (for `group`), and as a number. */
export interface Dimension {
  text: SQL
  json: SQL
  number: SQL
  /** Reads the Session's Labels, so the query must join them as `l`. */
  labels: boolean
}

const asNumber = (text: SQL) =>
  sql`(case when ${text} ~ ${numeric} then (${text})::double precision end)`

export function dimension(signal: Signal, key: string): Dimension {
  // `key` is request input: an inherited member such as `constructor` is not a column.
  const column = isPromoted(signal, key) ? promoted[signal][key] : undefined
  if (column === 'event_sequence') {
    const c = sql.raw('t.event_sequence')
    return {
      text: sql`${c}::text`,
      json: sql`to_jsonb(${c})`,
      number: sql`${c}::double precision`,
      labels: false,
    }
  }
  if (column !== undefined) {
    const own = sql.raw(`t.${column}`)
    const labelled = (linkLabels as readonly string[]).includes(key)
    const text = labelled ? sql`coalesce(l.labels ->> ${key}::text, ${own})` : own
    return { text, json: sql`to_jsonb(${text})`, number: asNumber(text), labels: labelled }
  }
  const value = sql`coalesce(t.attributes -> ${key}::text, t.resource -> ${key}::text)`
  const text = sql`coalesce(t.attributes ->> ${key}::text, t.resource ->> ${key}::text)`
  return {
    text,
    // Objects and arrays group by their text, so a `group` value is always a scalar.
    json: sql`(case when jsonb_typeof(${value}) in ('object', 'array') then to_jsonb(${value}::text)
      when jsonb_typeof(${value}) = 'null' then null else ${value} end)`,
    number: sql`(case jsonb_typeof(${value}) when 'number' then (${value})::double precision
      when 'string' then ${asNumber(text)} end)`,
    labels: false,
  }
}

type Scalar = string | number | boolean

export type Filter =
  | { key: string; op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'; value: Scalar }
  | { key: string; op: 'in' | 'not_in'; value: Scalar[] }
  | { key: string; op: 'exists' | 'not_exists' }

const list = (values: readonly Scalar[]) =>
  sql.join(
    values.map((v) => sql`${String(v)}`),
    sql`, `,
  )

const comparisons = { gt: '>', gte: '>=', lt: '<', lte: '<=' } as const

/**
 * One filter as a condition. Equality compares text forms, so `200` matches a status code
 * sent as a string or a number; ordering compares numbers when the value is a number. `neq`
 * and `not_in` also match rows that lack the key.
 */
export function condition(signal: Signal, filter: Filter): { where: SQL; labels: boolean } {
  const d = dimension(signal, filter.key)
  const where = (() => {
    switch (filter.op) {
      case 'exists':
        return sql`${d.text} is not null`
      case 'not_exists':
        return sql`${d.text} is null`
      case 'eq':
        return sql`${d.text} = ${String(filter.value)}`
      case 'neq':
        return sql`${d.text} is distinct from ${String(filter.value)}`
      case 'in':
        return sql`${d.text} in (${list(filter.value)})`
      case 'not_in':
        return sql`not coalesce(${d.text} in (${list(filter.value)}), false)`
      default: {
        const op = sql.raw(comparisons[filter.op])
        return typeof filter.value === 'number'
          ? sql`${d.number} ${op} ${filter.value}::double precision`
          : sql`${d.text} ${op} ${String(filter.value)}`
      }
    }
  })()
  return { where, labels: d.labels }
}

/** The Labels join, for queries whose dimensions read them. */
export const labelsJoin = sql`left join otel.session_labels l
  on l.owner_id = t.owner_id and l.session_id = t.session_id`
