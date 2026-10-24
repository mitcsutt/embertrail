import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'

import type { EmbertrailClient } from '@mitcsutt/embertrail-client'

import type { Args } from '../args.ts'
import type { Command, Context } from '../command.ts'
import { configPath, writePrivateFile } from '../config.ts'
import { CliError, UsageError } from '../errors.ts'
import { sourceWithToken } from '../ingest.ts'
import { endpoint } from '../import/http.ts'
import {
  convertEntry,
  defaultLokiLimit,
  defaultLokiSelector,
  logEntries,
  readEntries,
} from '../import/loki.ts'
import type { Converted } from '../import/loki.ts'
import { isObject } from '../import/otlp.ts'
import {
  convertSeries,
  defaultPrometheusSelector,
  readMetadata,
  readSeries,
} from '../import/prometheus.ts'
import type { Metadata } from '../import/prometheus.ts'
import { countItems, defaultBatchBytes, Replay } from '../import/replay.ts'
import type { Sent, Signal } from '../import/replay.ts'
import { storedCounts } from '../import/stored.ts'
import type { Stored } from '../import/stored.ts'
import { printable, table } from '../output.ts'

const units: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }

/** `90s`, `5m`, `6h`, `30d` in milliseconds. */
function duration(name: string, text: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(text)
  const value = match === null ? 0 : Number(match[1]) * (units[match[2] ?? ''] ?? 0)
  if (value <= 0)
    throw new UsageError(`--${name} ${text} is not a duration such as 90s, 5m, 6h or 30d`)
  return value
}

function positiveInteger(name: string, text: string | undefined, fallback: number): number {
  if (text === undefined) return fallback
  const value = Number(text)
  if (!Number.isInteger(value) || value <= 0) {
    throw new UsageError(`--${name} ${text} is not a positive integer`)
  }
  return value
}

const batchBytesOption = {
  'batch-bytes': {
    type: 'string' as const,
    value: 'bytes',
    description: `Merge Signals into requests of at most this size (default ${String(defaultBatchBytes)})`,
  },
}

const sourceOption = {
  source: {
    type: 'string' as const,
    value: 'name',
    required: true,
    description: 'The Source to store everything as (created if new)',
  },
  'dry-run': {
    type: 'boolean' as const,
    description: 'Read and convert, and report the counts, without sending anything',
  },
}

/** The target Source and a short-lived ingest Token for it, revoked by `close`. */
interface Target {
  hub: string
  client: EmbertrailClient
  source: { id: string; name: string }
  created: boolean
  token: string
  close(): Promise<void>
}

async function openTarget(ctx: Context, name: string): Promise<Target> {
  const { hub, token: managementToken } = await ctx.login()
  const client = await ctx.client()
  // A day is far longer than any import; the Token is revoked when the import ends anyway.
  const expiresAt = new Date(Date.now() + 86_400_000).toISOString()
  const opened = await sourceWithToken(client, managementToken, name, {
    tokenName: `import into ${name}`,
    expiresAt,
  })
  return {
    hub,
    client,
    source: opened.source,
    created: opened.created,
    token: opened.token,
    async close() {
      try {
        await client.revokeToken({ path: { token_id: opened.tokenId } })
      } catch {
        ctx.io.stderr(
          `warning: could not revoke the import's ingest Token ${opened.tokenId}; it expires at ${expiresAt}. Revoke it with embertrail tokens revoke ${opened.tokenId}\n`,
        )
      }
    },
  }
}

function replayFor(ctx: Context, target: Target | undefined, args: Args): Replay {
  return new Replay({
    io: ctx.io,
    hub: target?.hub ?? '',
    token: target?.token,
    batchBytes: positiveInteger('batch-bytes', args.string('batch-bytes'), defaultBatchBytes),
    onRefusal: (message) => {
      ctx.io.stderr(`The Hub refused some Signals: ${printable(message)}\n`)
    },
  })
}

interface Counts {
  read: number
  sent: number
  refused: number
  stored?: number
}

function countsTable(rows: Record<string, Counts>, stored: Stored | undefined): string {
  const cell = (value: number | undefined) => (value === undefined ? '-' : String(value))
  return table(
    ['', 'READ', 'SENT', 'REFUSED', 'STORED'],
    [
      ...Object.entries(rows).map(([what, c]) => [
        `  ${what}`,
        cell(c.read),
        cell(c.sent),
        cell(c.refused),
        cell(c.stored),
      ]),
      ...(stored === undefined ? [] : [['  Sessions', '-', '-', '-', String(stored.sessions)]]),
    ],
  )
}

function counts(read: number, sent: Sent, stored: number | undefined): Counts {
  return {
    read,
    sent: sent.sent,
    refused: sent.refused,
    ...(stored === undefined ? {} : { stored }),
  }
}

/** Fails the command, after the summary is printed, when anything was refused or unreadable. */
function failIfLost(refused: number, unreadable: number): void {
  const lost = [
    ...(refused > 0 ? [`the Hub refused ${String(refused)}`] : []),
    ...(unreadable > 0 ? [`${String(unreadable)} could not be read`] : []),
  ]
  if (lost.length > 0) throw new CliError(`Not everything was imported: ${lost.join(', ')}`)
}

/** The earliest and latest time in an OTLP entry, in nanoseconds. */
function timeRange(entry: unknown, range: { min?: bigint; max?: bigint }): void {
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (!isObject(value)) return
    const time = value.timeUnixNano
    if (typeof time === 'string' && /^\d+$/.test(time)) {
      const nanos = BigInt(time)
      if (range.min === undefined || nanos < range.min) range.min = nanos
      if (range.max === undefined || nanos > range.max) range.max = nanos
    }
    Object.values(value).forEach(visit)
  }
  visit(entry)
}

const importFile: Command = {
  path: ['import', 'file'],
  summary: 'Replay an embertrail export into the Hub as one Source',
  description:
    'Reads the OTLP JSON Lines that embertrail export otel writes (- reads standard input), ' +
    'merges them into requests under --batch-bytes and posts them through the Hub’s normal ingest ' +
    'with a short-lived ingest Token for --source, which is revoked at the end; then applies the ' +
    'Session Labels lines. The Hub skips what it already holds, so running it again adds nothing. ' +
    'Prints what was read, sent, refused and what the Hub now holds for the Source.',
  positionals: [{ name: 'file', description: 'The export file, or - for standard input' }],
  options: { ...sourceOption, ...batchBytesOption },
  async run(ctx, args) {
    const path = args.positional(0)
    const dryRun = args.flag('dry-run')
    const target = dryRun ? undefined : await openTarget(ctx, args.string('source') ?? '')
    const read = { logs: 0, metrics: 0, labels: 0, unreadable: 0 }
    const range: { min?: bigint; max?: bigint } = {}
    const labels: { session_id: string; labels: Record<string, string> }[] = []
    let totals: Record<Signal, Sent>
    let stored: Stored | undefined
    try {
      const replay = replayFor(ctx, target, args)
      const lines = createInterface({
        input: createReadStream(path === '-' ? '/dev/stdin' : path),
        crlfDelay: Infinity,
      })
      for await (const line of lines) {
        if (line.trim() === '') continue
        let parsed: unknown
        try {
          parsed = JSON.parse(line)
        } catch {
          read.unreadable += 1
          continue
        }
        if (!isObject(parsed)) {
          read.unreadable += 1
        } else if (Array.isArray(parsed.resourceLogs)) {
          for (const entry of parsed.resourceLogs) {
            read.logs += countItems('logs', entry)
            timeRange(entry, range)
            await replay.add('logs', entry)
          }
        } else if (Array.isArray(parsed.resourceMetrics)) {
          for (const entry of parsed.resourceMetrics) {
            read.metrics += countItems('metrics', entry)
            timeRange(entry, range)
            await replay.add('metrics', entry)
          }
        } else if (
          isObject(parsed.sessionLabels) &&
          typeof parsed.sessionLabels.session_id === 'string' &&
          isObject(parsed.sessionLabels.labels)
        ) {
          read.labels += 1
          labels.push(parsed.sessionLabels as (typeof labels)[number])
        } else {
          read.unreadable += 1
        }
      }
      totals = await replay.finish()
      if (target !== undefined) {
        // Labels after every Signal, as the export orders them.
        for (const item of labels) {
          await target.client.putSessionLabels({
            path: { session_id: item.session_id },
            body: { labels: item.labels },
          })
        }
        if (range.min !== undefined && range.max !== undefined) {
          stored = await storedCounts(
            target.client,
            target.source.id,
            new Date(Number(range.min / 1_000_000n)).toISOString(),
            new Date(Number(range.max / 1_000_000n) + 1).toISOString(),
          )
        }
      }
    } finally {
      await target?.close()
    }
    const rows = {
      Events: counts(read.logs, totals.logs, stored?.events),
      'Metric points': counts(read.metrics, totals.metrics, stored?.points),
    }
    ctx.print(
      {
        source: target?.source ?? null,
        dry_run: dryRun,
        events: rows.Events,
        points: rows['Metric points'],
        labels: read.labels,
        sessions: stored?.sessions ?? null,
        unreadable_lines: read.unreadable,
        requests: totals.logs.requests + totals.metrics.requests,
      },
      [
        target === undefined
          ? `Dry run: read ${path}, sent nothing.`
          : `${target.created ? 'Created' : 'Imported into'} Source "${printable(target.source.name)}" (${target.source.id}).`,
        countsTable(rows, stored),
        `Session Labels: ${String(read.labels)}. Unreadable lines: ${String(read.unreadable)}. Requests: ${String(totals.logs.requests + totals.metrics.requests)}.`,
        ...(target === undefined ? [] : ["The import's ingest Token is revoked."]),
      ].join('\n'),
    )
    failIfLost(totals.logs.refused + totals.metrics.refused, read.unreadable)
  },
}

/** Completed [start, end) windows per Signal, so an interrupted import picks up where it was. */
interface State {
  version: 1
  done: Record<Signal, [number, number][]>
}

function merged(intervals: readonly [number, number][]): [number, number][] {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0])
  const out: [number, number][] = []
  for (const [start, end] of sorted) {
    const last = out.at(-1)
    if (last !== undefined && start <= last[1]) last[1] = Math.max(last[1], end)
    else out.push([start, end])
  }
  return out
}

function covered(state: State, signal: Signal, start: number, end: number): boolean {
  return state.done[signal].some(([a, b]) => a <= start && end <= b)
}

async function readState(path: string): Promise<State> {
  const empty: State = { version: 1, done: { logs: [], metrics: [] } }
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty
    throw error
  }
  try {
    const parsed = JSON.parse(text) as Partial<State> | null
    if (
      parsed?.version === 1 &&
      Array.isArray(parsed.done?.logs) &&
      Array.isArray(parsed.done.metrics)
    ) {
      return { version: 1, done: parsed.done }
    }
  } catch {
    // Fall through: an unreadable state only costs a re-read.
  }
  return empty
}

/** [from, to) cut at multiples of `size` since the epoch, so every run cuts the same windows. */
function windows(from: number, to: number, size: number): [number, number][] {
  const out: [number, number][] = []
  for (let start = from; start < to;) {
    const end = Math.min(to, (Math.floor(start / size) + 1) * size)
    out.push([start, end])
    start = end
  }
  return out
}

function time(name: string, text: string, now: number): number {
  if (/^\d+(ms|s|m|h|d)$/.test(text)) return now - duration(name, text)
  const value = Date.parse(text)
  if (Number.isNaN(value)) {
    throw new UsageError(`--${name} ${text} is not a time (ISO 8601) or a duration such as 30d`)
  }
  return value
}

/** Metrics the import can turn into delta sums or gauges; the rest is counted as skipped. */
function metricType(name: string, metadata: ReadonlyMap<string, Metadata>): Metadata | undefined {
  const found = metadata.get(name)
  if (found !== undefined) {
    return found.type === 'counter' || found.type === 'gauge' ? found : undefined
  }
  return name.endsWith('_total') ? { type: 'counter', help: '' } : undefined
}

const importPrometheusLoki: Command = {
  path: ['import', 'prometheus-loki'],
  summary: 'Backfill the Hub from a Collector’s Prometheus (Metrics) and Loki (Events)',
  description:
    'Reads Claude Code telemetry that an OpenTelemetry Collector stored in Prometheus and Loki over ' +
    'a window, converts it back to OTLP (counters become delta sums) and posts it through the ' +
    'Hub’s normal ingest as one Source, with a short-lived ingest Token that is revoked at the end. ' +
    'The Hub skips what it already holds, so running it again adds nothing, and a state file lets ' +
    'an interrupted run pick up where it stopped. Prometheus keeps only a total per scrape, so ' +
    'Metric detail inside one scrape interval cannot be recovered; docs/import.md lists the rest.',
  options: {
    ...sourceOption,
    prometheus: { type: 'string', value: 'url', description: 'Prometheus to read Metrics from' },
    loki: { type: 'string', value: 'url', description: 'Loki to read Events from' },
    from: {
      type: 'string',
      value: 'time',
      description: 'Start of the window: ISO 8601, or a duration before --to (default 30d)',
    },
    to: {
      type: 'string',
      value: 'time',
      description: 'End of the window, exclusive (default now)',
    },
    'prometheus-selector': {
      type: 'string',
      value: 'selector',
      description: `The series to read (default ${defaultPrometheusSelector})`,
    },
    'loki-selector': {
      type: 'string',
      value: 'selector',
      description: `The streams to read (default ${defaultLokiSelector})`,
    },
    gap: {
      type: 'string',
      value: 'duration',
      description:
        'A counter silent for longer than this restarted from zero; keep it above twice the scrape interval (default 2m)',
    },
    chunk: {
      type: 'string',
      value: 'duration',
      description: 'Read the window in pieces this long (default 6h)',
    },
    'loki-limit': {
      type: 'string',
      value: 'lines',
      description: `Lines per Loki query, at most its max_entries_limit_per_query (default ${String(defaultLokiLimit)})`,
    },
    state: {
      type: 'string',
      value: 'file',
      description: 'Where to keep progress (default: a file beside the CLI config)',
    },
    restart: { type: 'boolean', description: 'Ignore earlier progress and read the whole window' },
    ...batchBytesOption,
  },
  async run(ctx, args) {
    const promUrl = args.string('prometheus')
    const lokiUrl = args.string('loki')
    if (promUrl === undefined && lokiUrl === undefined) {
      throw new UsageError('Give --prometheus, --loki or both')
    }
    const now = Date.now()
    const to = args.string('to') === undefined ? now : time('to', args.string('to') ?? '', now)
    const from = time('from', args.string('from') ?? '30d', to)
    if (from >= to) throw new UsageError('--from must be before --to')
    const gap = duration('gap', args.string('gap') ?? '2m')
    const chunk = duration('chunk', args.string('chunk') ?? '6h')
    const lokiLimit = positiveInteger('loki-limit', args.string('loki-limit'), defaultLokiLimit)
    const promSelector = args.string('prometheus-selector') ?? defaultPrometheusSelector
    const lokiSelector = args.string('loki-selector') ?? defaultLokiSelector
    const prometheus = promUrl === undefined ? undefined : endpoint(ctx.io, 'prometheus', promUrl)
    const loki = lokiUrl === undefined ? undefined : endpoint(ctx.io, 'loki', lokiUrl)
    const sourceName = args.string('source') ?? ''
    const dryRun = args.flag('dry-run')

    const { hub } = await ctx.login()
    const key = createHash('sha256')
      .update(
        JSON.stringify([
          hub,
          sourceName,
          prometheus?.base,
          promSelector,
          loki?.base,
          lokiSelector,
          gap,
        ]),
      )
      .digest('hex')
      .slice(0, 16)
    const statePath =
      args.string('state') ?? join(dirname(configPath(ctx.io)), 'import', `${key}.json`)
    const state: State = args.flag('restart')
      ? { version: 1, done: { logs: [], metrics: [] } }
      : await readState(statePath)

    const metadata =
      prometheus === undefined ? new Map<string, Metadata>() : await readMetadata(prometheus)
    const target = dryRun ? undefined : await openTarget(ctx, sourceName)
    const read = {
      events: 0,
      points: 0,
      samples: 0,
      series: 0,
      skippedSeries: 0,
      lines: 0,
      unreadable: 0,
    }
    const chunks = { read: 0, skipped: 0 }
    const skippedMetrics = new Set<string>()
    let totals: Record<Signal, Sent>
    let stored: Stored | undefined
    try {
      const replay = replayFor(ctx, target, args)
      const finished = async (signal: Signal, start: number, end: number) => {
        await replay.flush(signal)
        if (dryRun) return
        state.done[signal] = merged([...state.done[signal], [start, end]])
        await writePrivateFile(statePath, `${JSON.stringify(state)}\n`)
      }
      for (const [start, end] of windows(from, to, chunk)) {
        if (prometheus !== undefined) {
          if (covered(state, 'metrics', start, end)) {
            chunks.skipped += 1
          } else {
            chunks.read += 1
            for (const series of await readSeries(prometheus, promSelector, start, end, gap)) {
              const name = series.labels.__name__ ?? ''
              const type = metricType(name, metadata)
              if (type === undefined) {
                read.skippedSeries += 1
                skippedMetrics.add(name)
                continue
              }
              const converted = convertSeries(series, type, start, end, gap)
              if (converted.samples > 0) read.series += 1
              read.samples += converted.samples
              read.points += converted.points
              for (const entry of converted.entries) await replay.add('metrics', entry)
            }
            await finished('metrics', start, end)
          }
        }
        if (loki !== undefined) {
          if (covered(state, 'logs', start, end)) {
            chunks.skipped += 1
          } else {
            chunks.read += 1
            const converted: Converted[] = []
            for await (const entry of readEntries(loki, lokiSelector, start, end, lokiLimit)) {
              read.lines += 1
              const record = convertEntry(entry)
              if (record === undefined) read.unreadable += 1
              else converted.push(record)
            }
            read.events += converted.length
            for (const entry of logEntries(converted)) await replay.add('logs', entry)
            await finished('logs', start, end)
          }
        }
      }
      totals = await replay.finish()
      if (target !== undefined) {
        stored = await storedCounts(
          target.client,
          target.source.id,
          new Date(from).toISOString(),
          new Date(to).toISOString(),
        )
      }
    } finally {
      await target?.close()
    }

    const rows: Record<string, Counts> = {
      ...(loki === undefined ? {} : { Events: counts(read.events, totals.logs, stored?.events) }),
      ...(prometheus === undefined
        ? {}
        : { 'Metric points': counts(read.points, totals.metrics, stored?.points) }),
    }
    const window = `${new Date(from).toISOString()} to ${new Date(to).toISOString()}`
    ctx.print(
      {
        source: target?.source ?? null,
        dry_run: dryRun,
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
        events: rows.Events ?? null,
        points: rows['Metric points'] ?? null,
        sessions: stored?.sessions ?? null,
        prometheus: {
          series: read.series,
          samples: read.samples,
          skipped_series: read.skippedSeries,
          skipped_metrics: [...skippedMetrics].sort(),
        },
        loki: { lines: read.lines, unreadable: read.unreadable },
        chunks: { read: chunks.read, already_imported: chunks.skipped },
        state: dryRun ? null : statePath,
        requests: totals.logs.requests + totals.metrics.requests,
      },
      [
        target === undefined
          ? `Dry run over ${window}: sent nothing.`
          : `${target.created ? 'Created' : 'Imported into'} Source "${printable(target.source.name)}" (${target.source.id}), ${window}.`,
        countsTable(rows, stored),
        ...(prometheus === undefined
          ? []
          : [
              `Prometheus: ${String(read.series)} series, ${String(read.samples)} samples.` +
                (skippedMetrics.size === 0
                  ? ''
                  : ` Skipped ${String(read.skippedSeries)} series that are not counters or gauges: ${[...skippedMetrics].sort().join(', ')}.`),
            ]),
        ...(loki === undefined
          ? []
          : [
              `Loki: ${String(read.lines)} lines, ${String(read.unreadable)} not the Collector's JSON.`,
            ]),
        `Windows: ${String(chunks.read)} read, ${String(chunks.skipped)} already imported${dryRun ? '' : ` (progress in ${statePath})`}.`,
        ...(target === undefined ? [] : ["The import's ingest Token is revoked."]),
        ...(prometheus === undefined
          ? []
          : [
              'Metric points are one per scrape interval: Prometheus keeps totals, not each export. See docs/import.md.',
            ]),
      ].join('\n'),
    )
    failIfLost(totals.logs.refused + totals.metrics.refused, read.unreadable)
  },
}

export const importCommands: Command[] = [importFile, importPrometheusLoki]
