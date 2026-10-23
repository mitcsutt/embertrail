// OTLP/HTTP JSON in the shape Claude Code sends it (see packages/otel/test/fixtures/claude-code):
// `intValue` as a JSON number, every data point `asDouble`, `event.name` unprefixed beside a
// `claude_code.`-prefixed body, and `event.sequence` and `event.timestamp` on every Event.

export type AttributeValue = string | number | boolean
export type Attributes = Record<string, AttributeValue>

interface KeyValue {
  key: string
  value: Partial<Record<'stringValue' | 'boolValue' | 'intValue' | 'doubleValue', AttributeValue>>
}

/** OTLP `AnyValue`s for plain values: integers are `intValue`, other numbers `doubleValue`. */
export function keyValues(attributes: Attributes): KeyValue[] {
  return Object.entries(attributes).map(([key, value]) => {
    if (typeof value === 'string') return { key, value: { stringValue: value } }
    if (typeof value === 'boolean') return { key, value: { boolValue: value } }
    return Number.isInteger(value)
      ? { key, value: { intValue: value } }
      : { key, value: { doubleValue: value } }
  })
}

/** Unix nanoseconds as a decimal string. */
export function nanos(ms: number): string {
  return String(BigInt(ms) * 1_000_000n)
}

export interface EventRecord {
  /** Unix milliseconds. */
  time: number
  /** Unprefixed, such as `api_request`. */
  name: string
  attributes: Attributes
}

export interface SumPoint {
  metric: string
  unit: string
  attributes: Attributes
  /** Unix milliseconds the delta covers from, and to. */
  start: number
  time: number
  value: number
}

const resourceFor = (service: string, extra: Attributes) =>
  keyValues({
    'host.arch': 'arm64',
    'os.type': 'darwin',
    'os.version': '24.6.0',
    'service.name': service,
    'service.version': '2.1.296',
    ...extra,
  })

/** One `ExportLogsServiceRequest`: the Events of one Session, with sequence numbers from 0. */
export function logsRequest(
  service: string,
  resource: Attributes,
  events: EventRecord[],
  scope = 'com.anthropic.claude_code.events',
  prefix = 'claude_code',
) {
  const logRecords = events.map((event, sequence) => {
    const time = nanos(event.time)
    return {
      timeUnixNano: time,
      observedTimeUnixNano: time,
      body: { stringValue: `${prefix}.${event.name}` },
      attributes: keyValues({
        ...event.attributes,
        'event.name': event.name,
        'event.timestamp': new Date(event.time).toISOString(),
        'event.sequence': sequence,
      }),
      droppedAttributesCount: 0,
    }
  })
  return {
    resourceLogs: [
      {
        resource: { attributes: resourceFor(service, resource) },
        scopeLogs: [{ scope: { name: scope }, logRecords }],
      },
    ],
  }
}

/** One `ExportMetricsServiceRequest` of delta sums, one metric per name. */
export function metricsRequest(
  service: string,
  resource: Attributes,
  points: SumPoint[],
  scope = 'com.anthropic.claude_code',
) {
  const byMetric = new Map<string, SumPoint[]>()
  for (const point of points)
    byMetric.set(point.metric, [...(byMetric.get(point.metric) ?? []), point])
  const metrics = [...byMetric.entries()].map(([name, group]) => ({
    name,
    unit: group[0]?.unit ?? '',
    sum: {
      aggregationTemporality: 1,
      isMonotonic: true,
      dataPoints: group.map((point) => ({
        attributes: keyValues(point.attributes),
        startTimeUnixNano: nanos(point.start),
        timeUnixNano: nanos(point.time),
        asDouble: point.value,
      })),
    },
  }))
  return {
    resourceMetrics: [
      {
        resource: { attributes: resourceFor(service, resource) },
        scopeMetrics: [{ scope: { name: scope }, metrics }],
      },
    ],
  }
}
