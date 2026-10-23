// A real Hub for the Dashboard's tests: `testHub` on PGLite with the Modules a Hub ships, the demo
// dataset ingested through a Source-bound Token, and a client that reads it back the way the
// Dashboard does. Only the transport differs, `fetch` going into the Hub instead of the network.
// This sits outside `src/`, so it may import the Hub; the Dashboard's own code may not.

import { createClient } from '@mitcsutt/embertrail-client'
import type { EmbertrailClient } from '@mitcsutt/embertrail-client'
import { testHub } from '@mitcsutt/embertrail-hub/testing'
import type { TestClient, TestHub } from '@mitcsutt/embertrail-hub/testing'
import { hubModules } from '@mitcsutt/embertrail-modules'

import { demoDataset, demoNow, demoSource } from './demo/index.ts'
import type { DemoDataset, DemoOptions } from './demo/index.ts'

const baseUrl = 'http://hub.test'
const userId = 'dashboard'

export interface DashboardTestHubOptions {
  /** The Hub's clock, and the end of the demo data. Defaults to `demoNow`. */
  now?: Date
  /** The dataset to ingest; `false` leaves the Hub empty. Defaults to the demo dataset. */
  demo?: DemoOptions | false
  /** Whether to send the dataset's Labels. Defaults to true; `applyLabels` sends them later. */
  labels?: boolean
}

export interface DashboardTestHub {
  t: TestHub
  /** What the Dashboard holds: `otel:read`, `store:read` and `store:write`, no ingest. */
  client: EmbertrailClient
  /** The ingest client, bound to the Source `demo`. */
  ingest: TestClient
  /** The dataset that was ingested, if any. */
  demo: DemoDataset | undefined
  /** Sends the dataset's Labels, which `labels: false` held back. */
  applyLabels(): Promise<void>
  close(): Promise<void>
}

/** Posts the dataset's OTLP; fails on a status other than 200 or on anything refused. */
export async function ingestDemo(ingest: TestClient, dataset: DemoDataset): Promise<void> {
  for (const { path, body } of dataset.otlp) {
    const response = await ingest.post(path, body)
    const answer = (await response.json()) as { partialSuccess?: unknown }
    if (response.status !== 200 || answer.partialSuccess !== undefined) {
      throw new Error(
        `Ingesting ${path} answered ${String(response.status)}: ${JSON.stringify(answer)}`,
      )
    }
  }
}

/** Sets the dataset's Labels, which an ingest Token may do for any Session of its Owner. */
export async function labelDemo(ingest: TestClient, dataset: DemoDataset): Promise<void> {
  for (const { sessionId, labels } of dataset.labels) {
    const response = await ingest.put(`/api/v1/sessions/${sessionId}/labels`, { labels })
    if (response.status !== 200) {
      throw new Error(
        `Labelling ${sessionId} answered ${String(response.status)}: ${await response.text()}`,
      )
    }
  }
}

export async function dashboardTestHub(
  options: DashboardTestHubOptions = {},
): Promise<DashboardTestHub> {
  const now = options.now ?? demoNow
  const t = await testHub({ modules: hubModules, clock: () => now })
  try {
    await t.user(userId)
    const { token } = await t.hub.directory.issueToken(userId, {
      kind: 'management',
      scopes: ['otel:read', 'store:read', 'store:write'],
    })
    const client = createClient({
      baseUrl,
      token,
      fetch: (input, init) => t.hub.fetch(new Request(input, init)),
    })
    const ingest = t.as(userId, ['otel:write'], { sourceId: demoSource })
    const demo = options.demo === false ? undefined : demoDataset({ now, ...options.demo })
    if (demo !== undefined) {
      await ingestDemo(ingest, demo)
      if (options.labels !== false) await labelDemo(ingest, demo)
    }
    return {
      t,
      client,
      ingest,
      demo,
      applyLabels: () => (demo === undefined ? Promise.resolve() : labelDemo(ingest, demo)),
      close: () => t.close(),
    }
  } catch (error) {
    await t.close()
    throw error
  }
}
