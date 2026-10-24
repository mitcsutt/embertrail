// Sends synthetic Claude Code telemetry to a Collector's OTLP/HTTP receiver, as Claude Code
// would: for each Session, the startup and turn log flushes and two delta Metric flushes, at the
// current time. The payloads are the otel Module's synthetic fixtures, moved onto a new Session.
//
//   node packages/cli/test/import-stack/feed.ts --otlp http://127.0.0.1:4318 [--sessions 3] [--pause 7]

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    otlp: { type: 'string', default: 'http://127.0.0.1:4318' },
    sessions: { type: 'string', default: '3' },
    pause: { type: 'string', default: '7' },
  },
})
const otlp = values.otlp.replace(/\/+$/, '')
const pause = Number(values.pause) * 1000

const fixture = (name: string): string =>
  readFileSync(
    new URL(`../../../otel/test/fixtures/claude-code/${name}.json`, import.meta.url),
    'utf8',
  )

/** The fixture with its Session id replaced and every timestamp moved to `now`, in order. */
function moved(name: string, session: string, now: number): unknown {
  const original = fixture(name)
  const id = /"session\.id",\s*"value":\s*\{\s*"stringValue":\s*"([^"]+)"/.exec(original)?.[1]
  let text = id === undefined ? original : original.replaceAll(id, session)
  const stamps = [
    ...text.matchAll(/"(?:timeUnixNano|observedTimeUnixNano|startTimeUnixNano)":\s*"(\d+)"/g),
  ]
  const first = stamps.reduce(
    (min, m) => (BigInt(m[1] ?? '0') < min ? BigInt(m[1] ?? '0') : min),
    BigInt(stamps[0]?.[1] ?? '0'),
  )
  const shift = BigInt(now) * 1_000_000n - first
  text = text.replaceAll(
    /("(?:timeUnixNano|observedTimeUnixNano|startTimeUnixNano)":\s*")(\d+)"/g,
    (_all, prefix: string, nanos: string) => `${prefix}${String(BigInt(nanos) + shift)}"`,
  )
  text = text.replaceAll(
    /("event\.timestamp",\s*"value":\s*\{\s*"stringValue":\s*")([^"]+)"/g,
    (_all, prefix: string, stamp: string) =>
      `${prefix}${new Date(Date.parse(stamp) + Number(shift / 1_000_000n)).toISOString()}"`,
  )
  return JSON.parse(text)
}

async function post(path: string, body: unknown): Promise<void> {
  const response = await fetch(`${otlp}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`${path}: ${String(response.status)} ${await response.text()}`)
}

for (let n = 0; n < Number(values.sessions); n += 1) {
  const session = randomUUID()
  await post('/v1/logs', moved('logs-startup', session, Date.now()))
  await post('/v1/metrics', moved('metrics-first', session, Date.now()))
  await sleep(pause)
  await post('/v1/logs', moved('logs-turn', session, Date.now()))
  await post('/v1/metrics', moved('metrics-second', session, Date.now()))
  await sleep(pause)
  console.log(`sent Session ${session}`)
}
