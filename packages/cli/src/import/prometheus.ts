// Prometheus back to OTLP Metrics. A Collector's `prometheus` exporter turns Claude Code's delta
// sums into cumulative counters, which Prometheus samples at every scrape; the import reads the
// raw samples and sends the difference between consecutive samples as delta points, which is
// what the Hub stores. Detail inside one scrape interval is gone: see docs/import.md.

import type { Endpoint } from './http.ts'
import { getJson } from './http.ts'
import { attributeKey, importScope, keyValues, msToNanos, resourceKeys } from './otlp.ts'
import type { Json } from './otlp.ts'

export const defaultPrometheusSelector = '{__name__=~"claude_code_.+"}'

/** Claude Code's Metrics, with the unit the Prometheus name dropped or spelled differently. */
const known: readonly { name: string; unit: string }[] = [
  { name: 'claude_code.session.count', unit: '' },
  { name: 'claude_code.lines_of_code.count', unit: '' },
  { name: 'claude_code.pull_request.count', unit: '' },
  { name: 'claude_code.commit.count', unit: '' },
  { name: 'claude_code.cost.usage', unit: 'USD' },
  { name: 'claude_code.token.usage', unit: 'tokens' },
  { name: 'claude_code.code_edit_tool.decision', unit: '' },
  { name: 'claude_code.active_time.total', unit: 's' },
]

/** Suffixes the Collector's Prometheus naming adds: `_total` and the unit. */
const suffixes = new Set(['total', 'count', 'usd', 'tokens', 'seconds', 's'])

/** A name's words without the trailing suffixes, so `x_cost_usage_USD_total` → `x_cost_usage`. */
function stem(name: string): string {
  const words = name.toLowerCase().split(/[._]/)
  while (words.length > 1 && suffixes.has(words.at(-1) ?? '')) words.pop()
  return words.join('_')
}
const knownByStem = new Map(known.map((metric) => [stem(metric.name), metric]))

/** The OTel name and unit of a Prometheus metric name; an unknown one keeps its name. */
export function otelMetric(promName: string): { name: string; unit: string } {
  return knownByStem.get(stem(promName)) ?? { name: promName, unit: '' }
}

/** Labels Prometheus and the Collector add, which were never attributes. */
const dropped = new Set([
  '__name__',
  'job',
  'instance',
  'exported_job',
  'exported_instance',
  'otel_scope_name',
  'otel_scope_version',
])

export interface Sample {
  /** Milliseconds since the epoch. */
  t: number
  v: number
}

export interface Series {
  labels: Record<string, string>
  samples: Sample[]
}

export interface Metadata {
  type: string
  help: string
}

/** Each metric's type and help, from `/api/v1/metadata`. */
export async function readMetadata(endpoint: Endpoint): Promise<Map<string, Metadata>> {
  const body = await getJson(endpoint, '/api/v1/metadata', {})
  const data = (body as { data?: Record<string, { type?: string; help?: string }[]> }).data ?? {}
  return new Map(
    Object.entries(data).map(([name, [first]]) => [
      name,
      { type: first?.type ?? 'unknown', help: first?.help ?? '' },
    ]),
  )
}

/**
 * The raw samples of every series `selector` matches from `from - lookback` to `to` (an
 * instant query of a range selector, so there is no step to resample on).
 */
export async function readSeries(
  endpoint: Endpoint,
  selector: string,
  from: number,
  to: number,
  lookback: number,
): Promise<Series[]> {
  const end = to - 1
  const range = end - (from - lookback)
  const body = await getJson(endpoint, '/api/v1/query', {
    query: `${selector}[${String(range)}ms]`,
    time: (end / 1000).toFixed(3),
  })
  const result = (body as { data?: { result?: unknown } }).data?.result
  if (!Array.isArray(result)) return []
  return result.map((item: { metric?: Record<string, string>; values?: [number, string][] }) => ({
    labels: item.metric ?? {},
    samples: (item.values ?? [])
      .map(([seconds, value]) => ({ t: Math.round(seconds * 1000), v: Number(value) }))
      .filter((sample) => Number.isFinite(sample.v)),
  }))
}

export interface Point {
  /** Milliseconds; the previous sample's time, or absent when the series starts here. */
  start?: number
  time: number
  value: number
}

/**
 * A counter's increases in [`from`, `to`) as delta points: each sample minus the one before it,
 * or the sample itself after a reset (a drop) or when the series starts (no sample in the
 * `gap` before it, which is how the Collector's exporter restarts a series it expired). Zero
 * increases are left out. Only samples within `gap` of a point decide it, so overlapping
 * windows give the same points.
 */
export function counterPoints(samples: readonly Sample[], from: number, to: number, gap: number) {
  const sorted = [...samples].sort((a, b) => a.t - b.t)
  const points: Point[] = []
  sorted.forEach((sample, i) => {
    if (sample.t < from || sample.t >= to) return
    const before = sorted[i - 1]
    const previous = before !== undefined && sample.t - before.t <= gap ? before : undefined
    const increase =
      previous === undefined || sample.v < previous.v ? sample.v : sample.v - previous.v
    // Fifteen significant digits: the subtraction's floating-point noise, not the data's.
    const value = Number(increase.toPrecision(15))
    if (value === 0) return
    points.push(
      previous === undefined
        ? { time: sample.t, value }
        : { start: previous.t, time: sample.t, value },
    )
  })
  return points
}

/** A gauge's samples in [`from`, `to`), as they are. */
export function gaugePoints(samples: readonly Sample[], from: number, to: number): Point[] {
  return samples
    .filter((sample) => sample.t >= from && sample.t < to)
    .map((sample) => ({ time: sample.t, value: sample.v }))
}

/** A series' labels as OTel attributes, split between the point and its resource. */
export function seriesAttributes(labels: Readonly<Record<string, string>>) {
  const own: Record<string, Json> = {}
  const resource: Record<string, Json> = {}
  for (const [label, value] of Object.entries(labels)) {
    if (dropped.has(label)) continue
    const key = attributeKey(label)
    if (resourceKeys.has(key)) resource[key] = value
    else own[key] = value
  }
  // The Collector names the job after service.name; use it when the label itself is missing.
  const job = labels.exported_job
  if (resource['service.name'] === undefined && job !== undefined) resource['service.name'] = job
  const scope =
    labels.otel_scope_name === undefined
      ? importScope
      : {
          name: labels.otel_scope_name,
          ...(labels.otel_scope_version === undefined
            ? {}
            : { version: labels.otel_scope_version }),
        }
  return { own, resource, scope }
}

/** The largest number of points one entry holds, so no entry outgrows a batch. */
const pointsPerEntry = 500

/** A series' points in the window, as OTLP `resourceMetrics` entries. */
export function convertSeries(
  series: Series,
  metadata: Metadata,
  from: number,
  to: number,
  gap: number,
): { entries: Record<string, unknown>[]; points: number; samples: number } {
  const promName = series.labels.__name__ ?? ''
  const { name, unit } = otelMetric(promName)
  const isCounter = metadata.type === 'counter'
  const points = isCounter
    ? counterPoints(series.samples, from, to, gap)
    : gaugePoints(series.samples, from, to)
  const samples = series.samples.filter((s) => s.t >= from && s.t < to).length
  const { own, resource, scope } = seriesAttributes(series.labels)
  const attributes = keyValues(own)
  const entries: Record<string, unknown>[] = []
  for (let i = 0; i < points.length; i += pointsPerEntry) {
    const dataPoints = points.slice(i, i + pointsPerEntry).map((point) => ({
      attributes,
      ...(point.start === undefined ? {} : { startTimeUnixNano: msToNanos(point.start) }),
      timeUnixNano: msToNanos(point.time),
      asDouble: point.value,
    }))
    const metric = {
      name,
      unit,
      description: metadata.help,
      ...(isCounter
        ? { sum: { aggregationTemporality: 1, isMonotonic: true, dataPoints } }
        : { gauge: { dataPoints } }),
    }
    entries.push({
      resource: { attributes: keyValues(resource) },
      scopeMetrics: [{ scope, metrics: [metric] }],
    })
  }
  return { entries, points: points.length, samples }
}
