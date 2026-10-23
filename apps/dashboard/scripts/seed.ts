// Fills a Hub with the demo dataset, for `pnpm dev` and for looking at the Dashboard by hand.
//
//   pnpm --filter @mitcsutt/embertrail-dashboard seed [--now <iso>] [--tz <zone>] [--days <n>]
//
// It talks to the Hub `embertrail login` stored (or EMBERTRAIL_HUB and EMBERTRAIL_TOKEN), deletes
// the Source `embertrail-demo` if there is one (a hard delete removes the rows it sent), creates it again and
// sends the dataset through its ingest Token. Running it twice leaves the same rows.

import { parseArgs } from 'node:util'

import { createClient, items } from '@mitcsutt/embertrail-client'

import { demoDataset, demoSource } from '../test/demo/index.ts'
import { readConfig } from '../../../packages/cli/src/config.ts'
import { processIo } from '../../../packages/cli/src/io.ts'

const { values } = parseArgs({
  options: {
    now: { type: 'string' },
    tz: { type: 'string' },
    days: { type: 'string' },
    seed: { type: 'string' },
  },
})

// The top of the current hour, so seeding twice within the hour sends the same Signals.
const hour = 3_600_000
const now = new Date(
  values.now === undefined ? Math.floor(Date.now() / hour) * hour : Date.parse(values.now),
)
if (Number.isNaN(now.getTime())) throw new Error(`--now ${String(values.now)} is not a time`)

const positiveInteger = (name: string, text: string | undefined): number | undefined => {
  if (text === undefined) return undefined
  const value = Number(text)
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`--${name} ${text} is not a positive integer`)
  }
  return value
}
const days = positiveInteger('days', values.days)
const seed = positiveInteger('seed', values.seed)

const dataset = demoDataset({
  now,
  tz: values.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  ...(days === undefined ? {} : { days }),
  ...(seed === undefined ? {} : { seed }),
})

const config = await readConfig(processIo())
if (config === undefined) {
  throw new Error(
    'No Hub to talk to: run `embertrail login --hub <url> --token <token>`, or set EMBERTRAIL_HUB and EMBERTRAIL_TOKEN.',
  )
}
const hub = config.hub.replace(/\/+$/, '')
const { token } = config
const manage = createClient({ baseUrl: hub, token })

for (const source of (await manage.listSources()).items) {
  if (source.name === demoSource) await manage.deleteSource({ path: { source_id: source.id } })
}
const created = await manage.createSource({ body: { name: demoSource } })
const ingestToken = created.token.token

for (const { path, body } of dataset.otlp) {
  const response = await fetch(`${hub}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${ingestToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const answer = (await response.json()) as { partialSuccess?: unknown }
  if (!response.ok || answer.partialSuccess !== undefined) {
    throw new Error(
      `The Hub refused ${path} (${String(response.status)}): ${JSON.stringify(answer)}`,
    )
  }
}

const ingest = createClient({ baseUrl: hub, token: ingestToken })
for (const { sessionId, labels } of dataset.labels) {
  await ingest.putSessionLabels({ path: { session_id: sessionId }, body: { labels } })
}

// Read the counts back, so a run says what the Hub now holds for the embertrail-demo Source and fails if
// that is not the dataset. Other Sources on the same Hub are left out.
const { tz } = dataset.options
const window = {
  from: '2000-01-01T00:00:00Z',
  to: new Date(now.getTime() + hour).toISOString(),
  tz,
  filter: [{ key: 'embertrail.source_id', op: 'eq' as const, value: created.source.id }],
}
const events = await manage.queryEvents({
  body: { mode: 'aggregate', ...window, aggregation: { fn: 'count' } },
})
let points = 0
for (const metric of (await manage.getInventory()).metrics) {
  const counted = await manage.queryMetrics({
    body: { metric: metric.name, aggregation: 'count', ...window },
  })
  points += counted.rows.reduce((total, row) => total + (row.value ?? 0), 0)
}
const listed = []
for await (const session of items((cursor) =>
  manage.listSessions({ query: { source_id: created.source.id, cursor, limit: 1000 } }),
)) {
  listed.push(session)
}

const stored = {
  sessions: listed.length,
  events: 'rows' in events ? (events.rows[0]?.value ?? 0) : 0,
  points,
}
const expected = {
  sessions: dataset.facts.sessions,
  events: dataset.facts.eventCount,
  points: dataset.facts.pointCount,
}
console.log(`Seeded ${hub} as the Source "${demoSource}" (${tz}, up to ${now.toISOString()})`)
console.log(`  Hub holds   ${JSON.stringify(stored)}`)
console.log(`  dataset has ${JSON.stringify(expected)}`)
if (JSON.stringify(stored) !== JSON.stringify(expected)) {
  console.error('The Hub does not hold what was sent.')
  process.exitCode = 1
}
