// What the import reads turned back into the OTel data model: attribute keys from label names,
// plain JSON as OTLP `AnyValue`s, and times as `fixed64` nanoseconds.

/** Plain JSON, as Loki's lines and the Hub's stored attributes hold it. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

/**
 * Attribute keys Claude Code (and Embertrail's own link keys) spell with dots, which Prometheus
 * and Loki label names cannot hold: `session.id` arrives as `session_id`. A label not listed
 * here is kept as it is, since its dots, if it had any, cannot be told from underscores.
 */
const dotted = [
  'session.id',
  'user.id',
  'user.email',
  'user.account_uuid',
  'user.account_id',
  'organization.id',
  'terminal.type',
  'app.version',
  'prompt.id',
  'event.name',
  'event.sequence',
  'event.timestamp',
  'service.name',
  'service.version',
  'service.namespace',
  'service.instance.id',
  'os.type',
  'os.version',
  'host.arch',
  'wsl.version',
  'embertrail.group.id',
  'embertrail.group.kind',
  'embertrail.parent.session_id',
  'embertrail.role',
]
const keyOfLabel = new Map(dotted.map((key) => [key.replaceAll('.', '_'), key]))

/** The attribute key a Prometheus or Loki label name stands for. */
export function attributeKey(label: string): string {
  return keyOfLabel.get(label) ?? label
}

/** Keys Claude Code sends on the resource rather than on each record or point. */
export const resourceKeys: ReadonlySet<string> = new Set([
  'service.name',
  'service.version',
  'service.namespace',
  'service.instance.id',
  'os.type',
  'os.version',
  'host.arch',
  'wsl.version',
])

/** The scope an imported Signal gets when the source kept none. */
export const importScope = { name: 'embertrail-import' }

/** Plain JSON as an OTLP `AnyValue`: integers as `intValue` strings, per the spec. */
export function anyValue(value: Json): Record<string, unknown> {
  if (value === null) return {}
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'boolean') return { boolValue: value }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value }
  }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(anyValue) } }
  return { kvlistValue: { values: keyValues(value) } }
}

/** An object as an OTLP `KeyValue` list, keys sorted so the same object always sends the same. */
export function keyValues(object: Readonly<Record<string, Json>>): Record<string, unknown>[] {
  return Object.keys(object)
    .sort()
    .map((key) => ({ key, value: anyValue(object[key] ?? null) }))
}

/** Milliseconds since the epoch as a `fixed64` nanosecond string. */
export function msToNanos(ms: number): string {
  return String(BigInt(Math.round(ms)) * 1_000_000n)
}

/** JSON with object keys sorted at every level, for grouping equal resources. */
export function canonical(value: Json): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key] ?? null)}`).join(',')}}`
}

export function isObject(value: unknown): value is Record<string, Json> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
