// What the Hub holds for one Source in a window, read back through the Query API after an
// import, the way the Dashboard's seed checks itself.

import type { EmbertrailClient } from '@mitcsutt/embertrail-client'
import { pages } from '@mitcsutt/embertrail-client'

export interface Stored {
  sessions: number
  events: number
  points: number
}

/** Sessions, Events and Metric points the Source `sourceId` holds in [`from`, `to`). */
export async function storedCounts(
  client: EmbertrailClient,
  sourceId: string,
  from: string,
  to: string,
): Promise<Stored> {
  const window = {
    from,
    to,
    tz: 'UTC',
    filter: [{ key: 'embertrail.source_id', op: 'eq' as const, value: sourceId }],
  }
  const events = await client.queryEvents({
    body: { mode: 'aggregate', ...window, aggregation: { fn: 'count' } },
  })
  let points = 0
  for (const metric of (await client.getInventory()).metrics) {
    const counted = await client.queryMetrics({
      body: { metric: metric.name, aggregation: 'count', ...window },
    })
    points += counted.rows.reduce((total, row) => total + (row.value ?? 0), 0)
  }
  let sessions = 0
  for await (const page of pages((cursor) =>
    client.listSessions({ query: { source_id: sourceId, from, to, cursor, limit: 1000 } }),
  )) {
    sessions += page.items.length
  }
  return { sessions, events: 'rows' in events ? (events.rows[0]?.value ?? 0) : 0, points }
}
