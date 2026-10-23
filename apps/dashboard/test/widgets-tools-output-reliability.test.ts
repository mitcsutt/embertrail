// @vitest-environment node

// Catalogue batch B, except the Rhythm Widgets (those are in widgets-rhythm.test.ts): Tools, Output
// and Reliability against the demo dataset on a real Hub. Each Widget's data is compared with what
// the dataset says it sent, read back from the OTLP payloads and not from the Hub.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { activeTimePerDay } from '#features/widgets/components/ActiveTimePerDay'
import { apiErrors } from '#features/widgets/components/ApiErrors'
import { commitsPerDay } from '#features/widgets/components/CommitsPerDay'
import { editAcceptance } from '#features/widgets/components/EditAcceptance'
import { linesChangedPerDay } from '#features/widgets/components/LinesChangedPerDay'
import { requestLatency } from '#features/widgets/components/RequestLatency'
import { toolFailures } from '#features/widgets/components/ToolFailures'
import { topTools } from '#features/widgets/components/TopTools'

import { dashboardTestHub } from './hub.ts'
import type { DashboardTestHub } from './hub.ts'
import { add, eventsOf, pointsOf, wallClock } from './otlp.ts'
import { loadWidget, testContext } from './widget.ts'

let hub: DashboardTestHub
beforeAll(async () => {
  hub = await dashboardTestHub()
})
afterAll(async () => {
  await hub.close()
})

const tz = 'Europe/Berlin'
const demo = () => hub.demo ?? failed('demo')
const now = () => demo().options.now

function failed(what: string): never {
  throw new Error(`${what} is missing`)
}

/** The local day (`2026-11-04`) a day bucket starts. A bucket's string is its local midnight. */
const dayOf = (bucket: string) => bucket.slice(0, 10)

describe('Top tools', () => {
  it('ranks the tools by how often they were called, most first', async () => {
    const data = await loadWidget(hub.client, topTools, testContext(topTools, now()))

    const calls = new Map<string, number>()
    for (const event of eventsOf(demo(), 'tool_result'))
      add(calls, String(event.attributes.tool_name), 1)
    const expected = [...calls].toSorted(([, a], [, b]) => b - a).slice(0, 10)

    expect(expected).toHaveLength(8)
    expect(data.tools.map((tool) => tool.calls)).toEqual(expected.map(([, count]) => count))
    expect(new Map(data.tools.map((tool) => [tool.tool, tool.calls]))).toEqual(new Map(expected))
  })

  it('asks for ten and no more', () => {
    const request = topTools.request(testContext(topTools, now()))
    expect(request).toMatchObject({ op: 'queryEvents', body: { limit: 10 } })
  })
})

describe('Tool failures', () => {
  it('counts calls and failures per tool and ranks by failure rate', async () => {
    const data = await loadWidget(hub.client, toolFailures, testContext(toolFailures, now()))

    const calls = new Map<string, number>()
    const failures = new Map<string, number>()
    for (const event of eventsOf(demo(), 'tool_result')) {
      const tool = String(event.attributes.tool_name)
      add(calls, tool, 1)
      if (event.attributes.success === false) add(failures, tool, 1)
    }
    expect(calls.size).toBe(8)
    expect(new Map(data.tools.map((tool) => [tool.tool, tool.calls]))).toEqual(calls)
    for (const tool of data.tools)
      expect(tool.failures, tool.tool).toBe(failures.get(tool.tool) ?? 0)
    expect(data.tools.reduce((total, tool) => total + tool.failures, 0)).toBe(
      demo().facts.toolFailures,
    )

    const rates = data.tools.map((tool) => tool.failures / tool.calls)
    expect(rates).toEqual(rates.toSorted((a, b) => b - a))
  })
})

describe('Edit acceptance', () => {
  it('sums accepted and rejected edits as the dataset sent them', async () => {
    const data = await loadWidget(hub.client, editAcceptance, testContext(editAcceptance, now()))

    const decisions = new Map<string, number>()
    for (const point of pointsOf(demo(), 'claude_code.code_edit_tool.decision')) {
      add(decisions, String(point.attributes.decision), point.value)
    }
    expect([...decisions.keys()].toSorted()).toEqual(['accept', 'reject'])
    expect(new Map(data.decisions.map((row) => [row.decision, row.edits]))).toEqual(decisions)
  })
})

describe('Lines changed per day', () => {
  it('sums added and removed lines on each local day', async () => {
    const data = await loadWidget(
      hub.client,
      linesChangedPerDay,
      testContext(linesChangedPerDay, now()),
    )

    const expected = new Map<string, number>()
    for (const point of pointsOf(demo(), 'claude_code.lines_of_code.count')) {
      add(
        expected,
        `${wallClock(point.time, tz).day}|${String(point.attributes.type)}`,
        point.value,
      )
    }
    expect(new Set(data.rows.map((row) => row.type))).toEqual(new Set(['added', 'removed']))
    expect(expected.size).toBeGreaterThan(20)
    expect(new Map(data.rows.map((row) => [`${dayOf(row.day)}|${row.type}`, row.lines]))).toEqual(
      expected,
    )
  })
})

describe('Commits per day', () => {
  it('sums commits on each local day, adding up to the dataset’s commits', async () => {
    const data = await loadWidget(hub.client, commitsPerDay, testContext(commitsPerDay, now()))

    const expected = new Map<string, number>()
    for (const point of pointsOf(demo(), 'claude_code.commit.count')) {
      add(expected, wallClock(point.time, tz).day, point.value)
    }
    expect(expected.size).toBeGreaterThan(3)
    expect(new Map(data.rows.map((row) => [dayOf(row.day), row.commits]))).toEqual(expected)
    expect(data.rows.reduce((total, row) => total + row.commits, 0)).toBe(demo().facts.commits)
  })
})

describe('Active time per day', () => {
  it('sums your time and Claude’s on each local day', async () => {
    const data = await loadWidget(
      hub.client,
      activeTimePerDay,
      testContext(activeTimePerDay, now()),
    )

    const expected = new Map<string, number>()
    for (const point of pointsOf(demo(), 'claude_code.active_time.total')) {
      add(
        expected,
        `${wallClock(point.time, tz).day}|${String(point.attributes.type)}`,
        point.value,
      )
    }
    expect(new Set(data.rows.map((row) => row.type))).toEqual(new Set(['user', 'cli']))
    expect(data.rows).toHaveLength(expected.size)
    for (const row of data.rows) {
      expect(row.seconds, `${row.day} ${row.type}`).toBeCloseTo(
        expected.get(`${dayOf(row.day)}|${row.type}`) ?? NaN,
        4,
      )
    }
  })
})

describe('API errors', () => {
  it('counts errors by status over the dataset’s errors', async () => {
    const ctx = testContext(apiErrors, now())
    const data = await loadWidget(hub.client, apiErrors, ctx)

    // The Board's range is 90 days, so the buckets are days.
    expect(apiErrors.request(ctx)).toMatchObject({ body: { bucket: 'day' } })
    const expected = new Map<string, number>()
    for (const event of eventsOf(demo(), 'api_error')) {
      add(expected, `${wallClock(event.time, tz).day}|${String(event.attributes.status_code)}`, 1)
    }
    expect(expected.size).toBeGreaterThan(3)
    expect(new Map(data.rows.map((row) => [`${dayOf(row.at)}|${row.status}`, row.errors]))).toEqual(
      expected,
    )
    expect(data.rows.reduce((total, row) => total + row.errors, 0)).toBe(demo().facts.apiErrors)
  })

  it('asks for hours when the window is a day or two', () => {
    const request = apiErrors.request(
      testContext(apiErrors, now(), { time: { kind: 'relative', range: 'today' } }),
    )
    expect(request).toMatchObject({ body: { bucket: 'hour' } })
  })
})

describe('Request latency', () => {
  it('reports the p95 of request duration per model and day', async () => {
    const data = await loadWidget(hub.client, requestLatency, testContext(requestLatency, now()))

    // The 95th percentile by the continuous definition, which is what Postgres computes.
    const durations = new Map<string, number[]>()
    for (const event of eventsOf(demo(), 'api_request')) {
      const key = `${wallClock(event.time, tz).day}|${String(event.attributes.model)}`
      durations.set(key, [...(durations.get(key) ?? []), Number(event.attributes.duration_ms)])
    }
    expect(durations.size).toBeGreaterThan(50)
    expect(data.rows).toHaveLength(durations.size)
    for (const row of data.rows) {
      const sorted = (
        durations.get(`${dayOf(row.at)}|${row.model}`) ?? failed('durations')
      ).toSorted((a, b) => a - b)
      const rank = 0.95 * (sorted.length - 1)
      const low = Math.floor(rank)
      const expected =
        (sorted[low] ?? NaN) +
        ((sorted[low + 1] ?? sorted[low] ?? NaN) - (sorted[low] ?? NaN)) * (rank - low)
      expect(row.p95, `${row.at} ${row.model}`).toBeCloseTo(expected, 4)
    }
    expect(new Set(data.rows.map((row) => row.model)).size).toBe(3)
  })
})
