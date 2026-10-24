// The replay core every `embertrail import` shares: OTLP `resourceLogs` and `resourceMetrics`
// entries merged into requests under a byte budget, posted through the Hub's normal ingest with
// one Source's ingest Token, split in half when the Hub says a request is too big or too slow.
// Ingest de-duplicates, so replaying the same entries again stores nothing twice.

import { setTimeout as sleep } from 'node:timers/promises'

import { unreachable } from '../command.ts'
import { CliError } from '../errors.ts'
import type { Io } from '../io.ts'
import { printable } from '../output.ts'

export type Signal = 'logs' | 'metrics'

/** 256 KiB: roughly 1–2 ms of parsing on the Hub, inside Workers Free's 10 ms of CPU. */
export const defaultBatchBytes = 262_144

const paths: Record<Signal, string> = { logs: '/v1/logs', metrics: '/v1/metrics' }
const envelopeKeys: Record<Signal, string> = { logs: 'resourceLogs', metrics: 'resourceMetrics' }
const rejectedKeys: Record<Signal, string> = {
  logs: 'rejectedLogRecords',
  metrics: 'rejectedDataPoints',
}

/** What one Signal's replay did: records or points sent, refused, and requests made. */
export interface Sent {
  sent: number
  refused: number
  requests: number
}

export interface ReplayOptions {
  io: Io
  hub: string
  /** A Source-bound ingest Token; undefined for a dry run, which posts nothing. */
  token: string | undefined
  batchBytes: number
  /** Called with each distinct refusal message the Hub gives, once. */
  onRefusal?: (message: string) => void
  /** How long to wait before retry `n` (1, 2, …); tests pass zero. */
  backoff?: (attempt: number) => number
}

/** How many log records or data points an OTLP resource entry holds. */
export function countItems(signal: Signal, entry: unknown): number {
  let count = 0
  const scopes = signal === 'logs' ? 'scopeLogs' : 'scopeMetrics'
  for (const scope of array(field(entry, scopes))) {
    if (signal === 'logs') {
      count += array(field(scope, 'logRecords')).length
      continue
    }
    for (const metric of array(field(scope, 'metrics'))) {
      for (const kind of ['sum', 'gauge', 'histogram', 'exponentialHistogram', 'summary']) {
        count += array(field(field(metric, kind), 'dataPoints')).length
      }
    }
  }
  return count
}

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** The Hub answered that the request was too large, or too slow to parse (Cloudflare 1102). */
function tooHeavy(status: number, text: string): boolean {
  return status === 413 || status === 503 || /\b1102\b/.test(text)
}

const transient = new Set([429, 502, 504])
const attempts = 5

/**
 * Posts entries for both Signals, batched by size: `add` queues one resource entry, and a batch
 * is sent once the next entry would take it over `batchBytes` (an entry is never split).
 * `finish` sends what is left and returns the totals.
 */
export class Replay {
  private readonly options: ReplayOptions
  private readonly pending: Record<Signal, { entries: unknown[]; bytes: number }> = {
    logs: { entries: [], bytes: 0 },
    metrics: { entries: [], bytes: 0 },
  }
  private readonly messages = new Set<string>()
  readonly totals: Record<Signal, Sent> = {
    logs: { sent: 0, refused: 0, requests: 0 },
    metrics: { sent: 0, refused: 0, requests: 0 },
  }

  constructor(options: ReplayOptions) {
    this.options = options
  }

  async add(signal: Signal, entry: unknown): Promise<void> {
    const bytes = Buffer.byteLength(JSON.stringify(entry)) + 1
    const { entries, bytes: queued } = this.pending[signal]
    if (entries.length > 0 && queued + bytes > this.options.batchBytes) await this.flush(signal)
    // `flush` starts a new batch, so look it up again.
    const pending = this.pending[signal]
    pending.entries.push(entry)
    pending.bytes += bytes
  }

  async flush(signal: Signal): Promise<void> {
    const { entries } = this.pending[signal]
    this.pending[signal] = { entries: [], bytes: 0 }
    if (entries.length > 0) await this.send(signal, entries)
  }

  async finish(): Promise<Record<Signal, Sent>> {
    await this.flush('logs')
    await this.flush('metrics')
    return this.totals
  }

  private async send(signal: Signal, entries: unknown[]): Promise<void> {
    const count = entries.reduce<number>((total, entry) => total + countItems(signal, entry), 0)
    const totals = this.totals[signal]
    const { token } = this.options
    if (token === undefined) {
      totals.sent += count
      return
    }
    for (let attempt = 1; ; attempt += 1) {
      const response = await this.post(signal, entries, token)
      totals.requests += 1
      const text = await response.text()
      if (response.ok) {
        totals.sent += count
        this.refused(signal, text)
        return
      }
      if (tooHeavy(response.status, text) && entries.length > 1) {
        const half = Math.ceil(entries.length / 2)
        await this.send(signal, entries.slice(0, half))
        await this.send(signal, entries.slice(half))
        return
      }
      if (response.status === 413) {
        // One entry over the Hub's body limit: it can't be sent, and the rest of the run goes on.
        totals.refused += count
        this.note(
          `An entry of ${String(count)} ${signal === 'logs' ? 'Events' : 'points'} is over the Hub's body limit.`,
        )
        return
      }
      if (
        (transient.has(response.status) || tooHeavy(response.status, text)) &&
        attempt < attempts
      ) {
        await sleep(this.options.backoff?.(attempt) ?? 500 * 2 ** (attempt - 1))
        continue
      }
      throw new CliError(
        `The Hub answered ${String(response.status)} to ${paths[signal]}: ${printable(text.slice(0, 200))}`,
      )
    }
  }

  private async post(signal: Signal, entries: unknown[], token: string): Promise<Response> {
    const { hub, io } = this.options
    try {
      return await io.fetch(`${hub}${paths[signal]}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ [envelopeKeys[signal]]: entries }),
      })
    } catch (error) {
      throw unreachable(hub, error)
    }
  }

  /** Counts what a 200's `partialSuccess` refused. */
  private refused(signal: Signal, text: string): void {
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      return
    }
    const partial = field(body, 'partialSuccess')
    const rejected = Number(field(partial, rejectedKeys[signal]) ?? 0)
    if (Number.isFinite(rejected) && rejected > 0) this.totals[signal].refused += rejected
    const message = field(partial, 'errorMessage')
    if (typeof message === 'string' && message !== '') this.note(message)
  }

  private note(message: string): void {
    if (this.messages.has(message)) return
    this.messages.add(message)
    this.options.onRefusal?.(message)
  }
}
