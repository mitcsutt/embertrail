// OTLP/JSON values: unwrapping AnyValue to plain JSON for storage, wrapping it back for
// export, and the nanosecond timestamps both directions.

/** Plain JSON, as attributes are stored. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

/** An unwrapped attribute set. */
export type Attributes = Record<string, Json>

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The list at `key`, or an empty list when it is absent or not an array. */
export function list(value: unknown, key: string): unknown[] {
  if (!isObject(value)) return []
  const found = value[key]
  return Array.isArray(found) ? found : []
}

/**
 * An int64 as sent: a JSON number (Claude Code) or a decimal string (the spec). Safe integers
 * become numbers; larger ones stay strings so no digit is lost.
 */
function int64(value: unknown): Json {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    const number = Number(value)
    return Number.isSafeInteger(number) ? number : value
  }
  return null
}

/** A double as sent; proto3 JSON spells non-finite values as strings, kept as sent. */
function double(value: unknown): Json {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const number = Number(value)
    return Number.isFinite(number) ? number : value
  }
  return null
}

/** An OTLP `AnyValue` as plain JSON. An empty or unknown value is `null`. */
export function unwrap(value: unknown): Json {
  if (!isObject(value)) return null
  if ('stringValue' in value)
    return typeof value.stringValue === 'string' ? value.stringValue : null
  if ('boolValue' in value) return typeof value.boolValue === 'boolean' ? value.boolValue : null
  if ('intValue' in value) return int64(value.intValue)
  if ('doubleValue' in value) return double(value.doubleValue)
  if ('arrayValue' in value) return list(value.arrayValue, 'values').map(unwrap)
  if ('kvlistValue' in value) return attributes(list(value.kvlistValue, 'values'))
  if ('bytesValue' in value) return typeof value.bytesValue === 'string' ? value.bytesValue : null
  return null
}

/** An OTLP `KeyValue` list as an object. A repeated key keeps its last value. */
export function attributes(keyValues: readonly unknown[]): Attributes {
  const out: Attributes = {}
  for (const entry of keyValues) {
    if (isObject(entry) && typeof entry.key === 'string') out[entry.key] = unwrap(entry.value)
  }
  return out
}

/** Plain JSON back as an OTLP `AnyValue`: integers as `intValue` strings, per the spec. */
export function wrap(value: Json): Record<string, unknown> {
  if (value === null) return {}
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'boolean') return { boolValue: value }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value }
  }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(wrap) } }
  return { kvlistValue: { values: keyValues(value) } }
}

/** An object back as an OTLP `KeyValue` list. */
export function keyValues(object: Attributes): Record<string, unknown>[] {
  return Object.entries(object).map(([key, value]) => ({ key, value: wrap(value) }))
}

/**
 * A `fixed64` nanosecond timestamp (decimal string, or a JSON number from lenient senders) as
 * an ISO string with microseconds, Postgres's precision. `0`, absent and malformed are `null`.
 */
export function nanosToIso(value: unknown): string | null {
  let nanos: bigint
  if (typeof value === 'string' && /^\d+$/.test(value)) nanos = BigInt(value)
  else if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    nanos = BigInt(Math.trunc(value))
  } else return null
  if (nanos === 0n) return null
  const micros = nanos / 1000n
  const iso = new Date(Number(micros / 1000n)).toISOString()
  if (iso === 'Invalid Date') return null
  return `${iso.slice(0, -1)}${String(micros % 1000n).padStart(3, '0')}Z`
}

/** Microseconds since the epoch, as Postgres exports them, back to a `fixed64` string. */
export function microsToNanos(micros: string): string {
  return `${micros}000`
}

/** JSON with object keys sorted at every level: the same data always gives the same text. */
export function canonical(value: Json): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key] ?? null)}`).join(',')}}`
}

/** Lowercase hex SHA-256 of a string, through Web Crypto so it runs on every Platform. */
export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
