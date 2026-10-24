// Loki back to OTLP log records. The Collector's `loki` exporter writes each record as one JSON
// line (`body`, `attributes`, `resources`, `instrumentation_scope`, `severity`, `traceid`,
// `spanid`) and moves the attributes it was told to make labels out of the line into stream
// labels; the import reads the lines with `query_range` and puts both back together.

import { CliError } from '../errors.ts'

import type { Endpoint } from './http.ts'
import { getJson } from './http.ts'
import { anyValue, attributeKey, canonical, isObject, keyValues, resourceKeys } from './otlp.ts'
import type { Json } from './otlp.ts'

export const defaultLokiSelector = '{service_name="claude-code"}'

/** Stream labels the exporter adds, or that copy something the line already holds. */
const dropped = new Set(['exporter', 'job', 'instance', 'level', 'event_name'])

export interface Entry {
  labels: Record<string, string>
  /** Nanoseconds since the epoch, as Loki gives it. */
  ts: string
  line: string
}

/** Loki's own cap on one query's lines (`max_entries_limit_per_query`). */
export const defaultLokiLimit = 5000

/**
 * Every entry `selector` matches in [`from`, `to`) (milliseconds), oldest first, paging
 * forward from the newest timestamp each page reached.
 */
export async function* readEntries(
  endpoint: Endpoint,
  selector: string,
  from: number,
  to: number,
  limit = defaultLokiLimit,
): AsyncGenerator<Entry> {
  let start = BigInt(from) * 1_000_000n
  const end = BigInt(to) * 1_000_000n
  // Entries already yielded at `start`, which the next page asks for again.
  let seenAtStart = new Set<string>()
  for (;;) {
    const body = await getJson(endpoint, '/loki/api/v1/query_range', {
      query: selector,
      start: String(start),
      end: String(end),
      limit: String(limit),
      direction: 'forward',
    })
    const streams = (body as { data?: { result?: unknown } }).data?.result
    const page: Entry[] = []
    let returned = 0
    for (const stream of Array.isArray(streams) ? streams : []) {
      const { stream: labels, values } = stream as {
        stream?: Record<string, string>
        values?: [string, string][]
      }
      for (const [ts, line] of values ?? []) {
        returned += 1
        if (BigInt(ts) < end) page.push({ labels: labels ?? {}, ts, line })
      }
    }
    page.sort((a, b) => (BigInt(a.ts) < BigInt(b.ts) ? -1 : BigInt(a.ts) > BigInt(b.ts) ? 1 : 0))
    const last = page.at(-1)
    if (last === undefined) return
    const newest = BigInt(last.ts)
    const seen = newest === start ? seenAtStart : new Set<string>()
    let fresh = 0
    for (const entry of page) {
      const key = `${canonical(entry.labels)}\u0000${entry.ts}\u0000${entry.line}`
      if (BigInt(entry.ts) === start && seenAtStart.has(key)) continue
      if (BigInt(entry.ts) === newest) seen.add(key)
      fresh += 1
      yield entry
    }
    if (returned < limit) return
    if (fresh === 0) {
      throw new CliError(
        `More than ${String(limit)} Loki lines share the timestamp ${last.ts}; raise --loki-limit`,
      )
    }
    start = newest
    seenAtStart = seen
  }
}

/** One entry as an OTLP log record and the resource and scope it belongs to. */
export interface Converted {
  record: Record<string, unknown>
  resource: Record<string, Json>
  scope: Record<string, Json>
}

/** An entry as an OTLP log record; undefined when its line is not the exporter's JSON. */
export function convertEntry(entry: Entry): Converted | undefined {
  let line: unknown
  try {
    line = JSON.parse(entry.line)
  } catch {
    return undefined
  }
  if (!isObject(line)) return undefined
  const attributes: Record<string, Json> = isObject(line.attributes) ? { ...line.attributes } : {}
  const resource: Record<string, Json> = isObject(line.resources) ? { ...line.resources } : {}
  // Labels the exporter made from attributes or resource attributes go back where they were.
  for (const [label, value] of Object.entries(entry.labels)) {
    if (dropped.has(label)) continue
    const key = attributeKey(label)
    const target = resourceKeys.has(key) ? resource : attributes
    target[key] ??= value
  }
  const body: Json = line.body ?? entry.labels.event_name ?? null
  // Claude Code names the Event twice: `claude_code.api_request` in the body, `api_request` in
  // `event.name`, which is what the Hub reads. Restore the second from the first if it was lost.
  if (attributes['event.name'] === undefined && typeof body === 'string') {
    attributes['event.name'] = body.replace(/^claude_code\./, '')
  }
  const scope = isObject(line.instrumentation_scope)
    ? Object.fromEntries(
        Object.entries(line.instrumentation_scope).filter(
          ([key, value]) => (key === 'name' || key === 'version') && typeof value === 'string',
        ),
      )
    : {}
  const record: Record<string, unknown> = {
    timeUnixNano: entry.ts,
    ...(body === null ? {} : { body: anyValue(body) }),
    attributes: keyValues(attributes),
    ...(typeof line.severity === 'string' ? { severityText: line.severity } : {}),
    ...(typeof line.traceid === 'string' ? { traceId: line.traceid } : {}),
    ...(typeof line.spanid === 'string' ? { spanId: line.spanid } : {}),
  }
  return { record, resource, scope }
}

/** The largest number of records one entry holds, so no entry outgrows a batch. */
const recordsPerEntry = 100

/** Converted records grouped into `resourceLogs` entries by resource and scope, in order. */
export function logEntries(converted: readonly Converted[]): Record<string, unknown>[] {
  const groups = new Map<string, Converted[]>()
  for (const item of converted) {
    const key = canonical([item.resource, item.scope])
    const group = groups.get(key)
    if (group === undefined) groups.set(key, [item])
    else group.push(item)
  }
  const entries: Record<string, unknown>[] = []
  for (const group of groups.values()) {
    const [{ resource, scope } = { resource: {}, scope: {} }] = group
    for (let i = 0; i < group.length; i += recordsPerEntry) {
      entries.push({
        resource: { attributes: keyValues(resource) },
        scopeLogs: [
          { scope, logRecords: group.slice(i, i + recordsPerEntry).map((item) => item.record) },
        ],
      })
    }
  }
  return entries
}
