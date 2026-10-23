// @vitest-environment node

// `pnpm seed` against a Hub over HTTP: it fills the Hub with the demo dataset, and running it twice
// leaves the same rows. The script runs as a child process under plain Node, as a person runs it.

import { execFile } from 'node:child_process'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { serve } from '@hono/node-server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { dashboardTestHub } from './hub.ts'
import type { DashboardTestHub } from './hub.ts'
import { demoDataset, demoNow } from './demo/index.ts'

const run = promisify(execFile)
const dashboard = fileURLToPath(new URL('..', import.meta.url))

describe('pnpm seed', () => {
  let hub: DashboardTestHub
  let server: Server
  let env: Record<string, string>

  beforeAll(async () => {
    hub = await dashboardTestHub({ demo: false })
    const { token } = await hub.t.hub.directory.issueToken('dashboard', {
      kind: 'management',
      scopes: ['self:manage', 'otel:read', 'otel:write'],
    })
    server = serve({
      fetch: (request) => hub.t.hub.fetch(request),
      port: 0,
      hostname: '127.0.0.1',
    }) as Server
    await new Promise<void>((resolve) => server.once('listening', resolve))
    const { port } = server.address() as AddressInfo
    env = { EMBERTRAIL_HUB: `http://127.0.0.1:${String(port)}`, EMBERTRAIL_TOKEN: token }
  })

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve))
    await hub.close()
  })

  const seed = async () => {
    const { stdout } = await run(
      process.execPath,
      ['scripts/seed.ts', '--now', demoNow.toISOString(), '--tz', 'Europe/Berlin'],
      { cwd: dashboard, env: { ...process.env, ...env } },
    )
    return stdout
  }

  it('sends the dataset, and sends it again to the same rows', async () => {
    const { facts } = demoDataset()
    const counts = {
      sessions: facts.sessions,
      events: facts.eventCount,
      points: facts.pointCount,
    }
    const first = await seed()
    expect(first).toContain(`Hub holds   ${JSON.stringify(counts)}`)
    const second = await seed()
    expect(second).toContain(`Hub holds   ${JSON.stringify(counts)}`)

    const [stored] = await hub.t.sql<{ events: number; points: number; sources: number }>(
      `select (select count(*)::int from otel.otel_logs) as events,
        (select count(*)::int from otel.otel_metrics_sum) as points,
        (select count(*)::int from core.sources) as sources`,
    )
    expect(stored).toEqual({ events: counts.events, points: counts.points, sources: 1 })
    expect(hub.t.errors).toEqual([])
  }, 300_000)
})
