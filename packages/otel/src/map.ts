// Maps a parsed OTLP/JSON export request to the rows the tables store. Pure apart from the
// clock and the Account recogniser it is handed (`ctx.account` in the ops), so the benchmark
// measures exactly parse + map.

import { attributes, canonical, isObject, list, nanosToIso, sha256, unwrap } from './otlp'
import type { Attributes, Json } from './otlp'

/** Promoted on every Signal. */
interface Promoted {
  time: string
  serviceName: string
  sessionId: string | null
  accountId: string
  groupId: string | null
  groupKind: string | null
  parentSessionId: string | null
  role: string | null
  model: string | null
  scopeName: string
  scopeVersion: string
  attributes: Attributes
  resource: Attributes
}

export interface LogRow extends Promoted {
  observedTime: string | null
  eventName: string
  eventSequence: number | null
  promptId: string | null
  requestId: string | null
  severityNumber: number | null
  severityText: string | null
  body: Json
  traceId: string | null
  spanId: string | null
  /** Set only when the record lacks `session.id` or `event.sequence`. */
  contentHash: string | null
}

export interface MetricRow extends Promoted {
  startTime: string | null
  metricName: string
  description: string
  unit: string
  value: number
  type: string | null
  attributesHash: string
}

export interface SumRow extends MetricRow {
  isMonotonic: boolean
}

/** What a request maps to: rows to store and what was refused, for `partialSuccess`. */
export interface Mapped<R> {
  rows: R
  rejected: number
  /** Distinct reasons, in the order first seen. */
  messages: string[]
}

/** The OTel default when a sender has no `service.name`. */
const unknownService = 'unknown_service'

/** A string attribute from the record, falling back to the resource. */
function text(own: Attributes, resource: Attributes, key: string): string | null {
  const value = own[key] ?? resource[key]
  if (value === undefined || value === null) return null
  return typeof value === 'string' ? value : canonical(value)
}

function integer(value: Json | undefined): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    const number = Number(value)
    return Number.isSafeInteger(number) ? number : null
  }
  return null
}

/** OTLP's SeverityNumber runs 0 to 24; anything else is stored as unknown. */
function severity(value: unknown): number | null {
  const number = integer(value as Json | undefined)
  return number !== null && number >= 0 && number <= 24 ? number : null
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

/** OTLP/JSON trace and span ids are hex; empty means absent. */
function hexId(value: unknown): string | null {
  return typeof value === 'string' && /^[0-9a-fA-F]+$/.test(value) && !/^0+$/.test(value)
    ? value.toLowerCase()
    : null
}

/** Recognises the core Account a set of telemetry attributes names (`ctx.account`). */
export type AccountRecogniser = (attributes: Readonly<Record<string, unknown>>) => Promise<string>

/** The attributes core Account recognition reads, the record's own winning over the resource. */
const accountAttributes = ['organization.id', 'user.account_uuid', 'user.email']

interface Context {
  resource: Attributes
  scopeName: string
  scopeVersion: string
}

/** Walks `resource<Kind>[].scope<Kind>[]`, yielding each scope's items with their context. */
function* scopes(request: unknown, resourceKey: string, scopeKey: string, itemKey: string) {
  for (const resourceEntry of list(request, resourceKey)) {
    const resource = attributes(
      list(isObject(resourceEntry) ? resourceEntry.resource : undefined, 'attributes'),
    )
    for (const scopeEntry of list(resourceEntry, scopeKey)) {
      const scope = isObject(scopeEntry) && isObject(scopeEntry.scope) ? scopeEntry.scope : {}
      const context: Context = {
        resource,
        scopeName: string(scope.name) ?? '',
        scopeVersion: string(scope.version) ?? '',
      }
      yield { context, items: list(scopeEntry, itemKey) }
    }
  }
}

async function promote(
  own: Attributes,
  context: Context,
  time: string,
  account: AccountRecogniser,
): Promise<Promoted> {
  const { resource } = context
  return {
    time,
    serviceName: text(own, resource, 'service.name') ?? unknownService,
    sessionId: text(own, resource, 'session.id'),
    accountId: await account(
      Object.fromEntries(accountAttributes.map((key) => [key, text(own, resource, key)])),
    ),
    groupId: text(own, resource, 'embertrail.group.id'),
    groupKind: text(own, resource, 'embertrail.group.kind'),
    parentSessionId: text(own, resource, 'embertrail.parent.session_id'),
    role: text(own, resource, 'embertrail.role'),
    model: text(own, resource, 'model'),
    scopeName: context.scopeName,
    scopeVersion: context.scopeVersion,
    attributes: own,
    resource,
  }
}

/** The time a record happened: its own time, else when it was observed, else `now`. */
function recordTime(record: Record<string, unknown>, own: Attributes, now: Date) {
  const time = nanosToIso(record.timeUnixNano) ?? nanosToIso(record.observedTimeUnixNano)
  if (time !== null) return time
  const stamp = own['event.timestamp']
  if (typeof stamp === 'string' && !Number.isNaN(Date.parse(stamp))) {
    return nanosToIso(`${String(Date.parse(stamp))}000000`) ?? now.toISOString()
  }
  return now.toISOString()
}

/** An `ExportLogsServiceRequest` as Event rows. Every record is stored; none is dropped. */
export async function mapLogs(
  request: unknown,
  now: Date,
  account: AccountRecogniser,
): Promise<Mapped<LogRow[]>> {
  const rows: LogRow[] = []
  let rejected = 0
  const messages = new Set<string>()
  for (const { context, items } of scopes(request, 'resourceLogs', 'scopeLogs', 'logRecords')) {
    for (const record of items) {
      if (!isObject(record)) {
        rejected += 1
        messages.add('A log record is not a JSON object.')
        continue
      }
      const own = attributes(list(record, 'attributes'))
      const time = recordTime(record, own, now)
      const base = await promote(own, context, time, account)
      const eventName = text(own, {}, 'event.name') ?? string(record.eventName) ?? ''
      const eventSequence = integer(own['event.sequence'])
      const severityNumber = severity(record.severityNumber)
      const severityText = string(record.severityText)
      const body = unwrap(record.body)
      const row: LogRow = {
        ...base,
        observedTime: nanosToIso(record.observedTimeUnixNano),
        eventName,
        eventSequence,
        promptId: text(own, {}, 'prompt.id'),
        requestId: text(own, {}, 'request_id'),
        severityNumber,
        severityText,
        body,
        traceId: hexId(record.traceId),
        spanId: hexId(record.spanId),
        contentHash: null,
      }
      if (base.sessionId === null || eventSequence === null) {
        // Exact retries collapse; any difference in what was sent keeps records apart.
        row.contentHash = await sha256(
          canonical([
            time,
            eventName,
            own,
            body,
            severityNumber,
            severityText,
            context.resource,
            context.scopeName,
          ]),
        )
      }
      rows.push(row)
    }
  }
  return { rows, rejected, messages: [...messages] }
}

/** A data point's value: `asDouble` or `asInt`, each as a number or a string. */
function pointValue(point: Record<string, unknown>): number | null {
  const raw = 'asDouble' in point ? point.asDouble : 'asInt' in point ? point.asInt : undefined
  const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

const delta = 1
const unsupported = ['histogram', 'exponentialHistogram', 'summary'] as const

/** An `ExportMetricsServiceRequest` as rows: delta sums and gauges; the rest refused. */
export async function mapMetrics(
  request: unknown,
  account: AccountRecogniser,
): Promise<Mapped<{ sums: SumRow[]; gauges: MetricRow[] }>> {
  const sums: SumRow[] = []
  const gauges: MetricRow[] = []
  let rejected = 0
  const messages = new Set<string>()
  const refuse = (count: number, message: string) => {
    if (count === 0) return
    rejected += count
    messages.add(message)
  }

  for (const { context, items } of scopes(request, 'resourceMetrics', 'scopeMetrics', 'metrics')) {
    for (const metric of items) {
      if (!isObject(metric)) {
        refuse(1, 'A metric is not a JSON object.')
        continue
      }
      const name = string(metric.name) ?? ''
      const kind = unsupported.find((k) => k in metric)
      if (kind !== undefined) {
        refuse(
          list(metric[kind], 'dataPoints').length,
          `Metric "${name}" is a ${kind}; Embertrail stores only sums and gauges.`,
        )
        continue
      }
      const isSum = isObject(metric.sum)
      const data = isSum ? metric.sum : metric.gauge
      if (!isObject(data)) continue
      const points = list(data, 'dataPoints')
      if (isSum && data.aggregationTemporality !== delta) {
        refuse(
          points.length,
          `Metric "${name}" uses cumulative temporality; Embertrail stores delta sums only. ` +
            'Set OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=delta.',
        )
        continue
      }
      for (const point of points) {
        if (!isObject(point)) {
          refuse(1, `Metric "${name}" has a data point that is not a JSON object.`)
          continue
        }
        const time = nanosToIso(point.timeUnixNano)
        const value = pointValue(point)
        if (time === null || value === null) {
          refuse(1, `Metric "${name}" has a data point without a time or a finite value.`)
          continue
        }
        const own = attributes(list(point, 'attributes'))
        const base = await promote(own, context, time, account)
        const row: MetricRow = {
          ...base,
          startTime: nanosToIso(point.startTimeUnixNano),
          metricName: name,
          description: typeof metric.description === 'string' ? metric.description : '',
          unit: typeof metric.unit === 'string' ? metric.unit : '',
          value,
          type: text(own, {}, 'type'),
          attributesHash: await sha256(canonical([own, context.resource, context.scopeName])),
        }
        if (isSum) sums.push({ ...row, isMonotonic: data.isMonotonic === true })
        else gauges.push(row)
      }
    }
  }
  return { rows: { sums, gauges }, rejected, messages: [...messages] }
}

/** Counts the spans in an `ExportTraceServiceRequest`, all of which are refused. */
export function countSpans(request: unknown): number {
  let spans = 0
  for (const { items } of scopes(request, 'resourceSpans', 'scopeSpans', 'spans')) {
    spans += items.length
  }
  return spans
}
