// Reads the demo dataset's OTLP payloads back into plain records, so a Widget's test can work out
// what a Widget should show from what was sent, without going through the Hub or the Widget.

import type { DemoDataset } from './demo/index.ts'

export type Attributes = Record<string, string | number | boolean>

export interface Sent {
  /** The Metric or Event name, such as `claude_code.cost.usage` or `tool_result`. */
  name: string
  /** Unix milliseconds: a data point's end, an Event's time. */
  time: number
  attributes: Attributes
  /** A data point's value; Events have none. */
  value: number
}

interface KeyValue {
  key: string
  value: Record<string, string | number | boolean>
}

const attributesOf = (list: KeyValue[]): Attributes =>
  Object.fromEntries(list.map(({ key, value }) => [key, Object.values(value)[0] ?? '']))

const millis = (nanos: string) => Number(BigInt(nanos) / 1_000_000n)

/** Every data point the dataset sends for a Metric. */
export function pointsOf(dataset: DemoDataset, metric: string): Sent[] {
  const found: Sent[] = []
  for (const { path, body } of dataset.otlp) {
    if (path !== '/v1/metrics') continue
    const resources = (body as { resourceMetrics: unknown[] }).resourceMetrics as {
      scopeMetrics: {
        metrics: {
          name: string
          sum: { dataPoints: { attributes: KeyValue[]; timeUnixNano: string; asDouble: number }[] }
        }[]
      }[]
    }[]
    for (const resource of resources) {
      for (const scope of resource.scopeMetrics) {
        for (const item of scope.metrics) {
          if (item.name !== metric) continue
          for (const point of item.sum.dataPoints) {
            found.push({
              name: metric,
              time: millis(point.timeUnixNano),
              attributes: attributesOf(point.attributes),
              value: point.asDouble,
            })
          }
        }
      }
    }
  }
  return found
}

/** Every Event the dataset sends with this unprefixed name, such as `tool_result`. */
export function eventsOf(dataset: DemoDataset, name: string): Sent[] {
  const found: Sent[] = []
  for (const { path, body } of dataset.otlp) {
    if (path !== '/v1/logs') continue
    const resources = (body as { resourceLogs: unknown[] }).resourceLogs as {
      scopeLogs: { logRecords: { timeUnixNano: string; attributes: KeyValue[] }[] }[]
    }[]
    for (const resource of resources) {
      for (const scope of resource.scopeLogs) {
        for (const record of scope.logRecords) {
          const attributes = attributesOf(record.attributes)
          if (attributes['event.name'] !== name) continue
          found.push({ name, time: millis(record.timeUnixNano), attributes, value: 1 })
        }
      }
    }
  }
  return found
}

const parts = new Map<string, Intl.DateTimeFormat>()

/**
 * Where an instant falls on a zone's wall clock, read with `Intl` and nothing else: the local
 * date (`2026-11-01`), hour (0 to 23) and weekday (Monday is 0).
 */
export function wallClock(
  time: number,
  tz: string,
): { day: string; hour: number; weekday: number } {
  let format = parts.get(tz)
  if (format === undefined) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      weekday: 'short',
    })
    parts.set(tz, format)
  }
  const found = Object.fromEntries(
    format.formatToParts(new Date(time)).map((p) => [p.type, p.value]),
  )
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  return {
    day: `${found.year ?? ''}-${found.month ?? ''}-${found.day ?? ''}`,
    hour: Number(found.hour),
    weekday: weekdays.indexOf(found.weekday ?? ''),
  }
}

/** Adds `value` to `map[key]`. */
export function add<K>(map: Map<K, number>, key: K, value: number): void {
  map.set(key, (map.get(key) ?? 0) + value)
}
