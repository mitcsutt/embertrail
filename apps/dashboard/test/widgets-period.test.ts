// @vitest-environment node

// The KPIs against the demo dataset on a real Hub: each total over the last 7 days, and over the 7
// days before, equals the sum of the data points the dataset sent in that window (read back from
// its OTLP, not from the Hub).

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { periodActiveTime } from '#features/widgets/components/PeriodActiveTime'
import { periodCommits } from '#features/widgets/components/PeriodCommits'
import { periodCost } from '#features/widgets/components/PeriodCost'
import { periodLinesChanged } from '#features/widgets/components/PeriodLinesChanged'
import { periodSessions } from '#features/widgets/components/PeriodSessions'
import { periodTokens } from '#features/widgets/components/PeriodTokens'
import { previousWindow } from '#features/widgets/utils/previousWindow'

import { dashboardTestHub } from './hub.ts'
import type { DashboardTestHub } from './hub.ts'
import { pointsOf } from './otlp.ts'
import { loadWidget, testContext } from './widget.ts'

let hub: DashboardTestHub
beforeAll(async () => {
  hub = await dashboardTestHub()
})
afterAll(async () => {
  await hub.close()
})

const demo = () => hub.demo ?? failed('demo')

function failed(what: string): never {
  throw new Error(`${what} is missing`)
}

const sent = (metric: string, from: string, to: string) =>
  pointsOf(demo(), metric)
    .filter(({ time }) => time >= Date.parse(from) && time < Date.parse(to))
    .reduce((sum, { value }) => sum + value, 0)

describe.each([
  ['Cost', periodCost, 'claude_code.cost.usage'],
  ['Sessions', periodSessions, 'claude_code.session.count'],
  ['Tokens', periodTokens, 'claude_code.token.usage'],
  ['Active time', periodActiveTime, 'claude_code.active_time.total'],
  ['Lines changed', periodLinesChanged, 'claude_code.lines_of_code.count'],
  ['Commits', periodCommits, 'claude_code.commit.count'],
])('%s', (_title, widget, metric) => {
  const week = () =>
    testContext(widget, demo().options.now, { time: { kind: 'relative', range: 'last-7-days' } })

  it('totals the last 7 days and the same time into the 7 before them', async () => {
    const ctx = week()
    const before = previousWindow(ctx)
    const data = await loadWidget(hub.client, widget, ctx)

    expect(data.total).toBeCloseTo(sent(metric, ctx.from, ctx.to), 6)
    expect(data.previous).toBeCloseTo(sent(metric, before.from, before.previousUntil), 6)
    expect(data.total).toBeGreaterThan(0)
    expect(data.previous).toBeGreaterThan(0)
  })

  it('draws one sparkline point per day, summing to the total', async () => {
    const data = await loadWidget(hub.client, widget, week())
    expect(data.points).toHaveLength(7)
    expect(data.points.reduce((sum, { value }) => sum + value, 0)).toBeCloseTo(data.total ?? 0, 6)
  })
})
