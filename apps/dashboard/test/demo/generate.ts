// The demo dataset: five weeks of one person's Claude Code Sessions as the OTLP the Hub takes,
// deterministic for a given `now`, zone, length and seed. It is plain TypeScript with explicit
// `.ts` imports and no workspace imports, so Node 24 runs it as is (`pnpm seed`) and the tests
// ingest the same payloads into a test Hub.
//
// Everything in `facts` is computed from the payloads it returns, so a test can assert exact
// numbers without re-deriving them.

import { logsRequest, metricsRequest } from './otlp.ts'
import type { Attributes, EventRecord, SumPoint } from './otlp.ts'
import { createRandom } from './random.ts'
import type { Random } from './random.ts'
import { addDays, dayBounds, localDate, offsetChange, weekStart, zonedTime } from './zone.ts'
import type { CalendarDate } from './zone.ts'

/** The default "now": a Wednesday afternoon after both the Berlin and New York clock changes. */
export const demoNow = new Date('2026-11-04T13:00:00Z')

/** The name of the Source the seed command creates. */
export const demoSource = 'embertrail-demo'

export type AccountKey = 'work' | 'personal'

/** The two Accounts the Sessions belong to. Their ids are the Hub's; these are what Claude Code sends. */
export const demoAccounts = {
  work: {
    userId: '7d1c5f0a9b3e4c2d8a6f1e0b9c7d5a3f4e2b1c0d9a8f7e6d5c4b3a2f1e0d9c8b',
    email: 'dev@example.com',
    accountUuid: '3f6c2a10-8b47-4d59-9e1a-5c7b2d4f6a80',
    accountId: 'user_Wk3mDemo0Work001',
    organizationId: 'a4e9d7b2-1c58-4f3a-b6d0-2e8c9f1a7b35',
  },
  personal: {
    userId: '2b8e4d6f1a3c5e7092b4d6f8a0c2e4608a1c3e5b7d9f1a3c5e7092b4d6f8a0c2',
    email: 'dev@example.org',
    accountUuid: '9a2e7c14-5d30-4b86-8f1c-7e3a5b9d2c46',
    accountId: 'user_Pe4rDemo0Home002',
    organizationId: undefined,
  },
} as const

export type ModelId = 'claude-opus-4-7' | 'claude-sonnet-4-6' | 'claude-haiku-4-5'

/** Dollars per million tokens. */
const prices: Record<
  ModelId,
  Record<'input' | 'output' | 'cacheRead' | 'cacheCreation', number>
> = {
  'claude-opus-4-7': { input: 15, output: 75, cacheRead: 1.5, cacheCreation: 18.75 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, cacheCreation: 3.75 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheCreation: 1.25 },
}

const tools = [
  ['Read', 30],
  ['Bash', 25],
  ['Edit', 20],
  ['Grep', 10],
  ['Write', 5],
  ['Glob', 5],
  ['Task', 3],
  ['WebFetch', 2],
] as const

const failureRate: Record<string, number> = { Bash: 0.12, Edit: 0.06, WebFetch: 0.2 }
const editTools = new Set(['Edit', 'Write'])

export type SenderKind = 'claude-code' | 'other'

export interface DemoOptions {
  /** The end of the data; later times are never generated. */
  now?: Date
  /** The zone the working day follows, an IANA name. */
  tz?: string
  /** Local days of data, ending with the day of `now`. */
  days?: number
  seed?: number
  /** `other` is a sender that isn't Claude Code, for empty-state tests. */
  sender?: SenderKind
}

export interface OtlpRequest {
  path: '/v1/logs' | '/v1/metrics'
  body: Record<string, unknown>
}

/** Labels for one Session, sent after its Signals. */
export interface SessionLabels {
  sessionId: string
  labels: Record<string, string>
}

/** A Session's place in a Session Group, as attributes or Labels give it. */
export interface Link {
  groupId?: string
  groupKind?: string
  parentId?: string
  role?: string
}

export interface DemoSessionFact {
  id: string
  /** ISO times of the first Event and the end of the last turn. */
  start: string
  end: string
  account: AccountKey
  model: ModelId
  turns: number
  cost: number
  /** What the Session sent in its resource attributes. */
  emitted: Link
  /** After its Labels: a reserved Label wins over the attribute. */
  effective: Link
}

export interface DemoGroupFact {
  id: string
  kind: string
  /** Every member, parents before children. */
  sessionIds: string[]
  /** Members whose parent is not in the group. */
  rootIds: string[]
  /** Levels, so 3 for a root, its child and its grandchild. */
  depth: number
  /** The members' cost, which is what the group's total must equal. */
  cost: number
}

export interface DemoFacts {
  /** The local days the Board-less Widgets read, as ISO instants. */
  today: { from: string; to: string }
  thisWeek: { from: string; to: string }
  sessions: number
  sessionsToday: number
  cost: number
  costToday: number
  costThisWeek: number
  costByModel: Record<string, number>
  costByAccount: Record<AccountKey, number>
  eventCount: number
  pointCount: number
  eventsByName: Record<string, number>
  commits: number
  apiErrors: number
  toolFailures: number
  sessionFacts: DemoSessionFact[]
  groups: DemoGroupFact[]
  /** The Session a Label moves from one group to another. */
  relabelled?: { sessionId: string; from: string; to: string }
}

export interface DemoDataset {
  options: Required<DemoOptions>
  otlp: OtlpRequest[]
  labels: SessionLabels[]
  facts: DemoFacts
}

interface Plan {
  id: string
  start: number
  account: AccountKey
  startType: 'fresh' | 'resume'
  turns: number
  model: ModelId
  emitted: Link
  labels?: Link
}

interface Run {
  plan: Plan
  events: EventRecord[]
  points: SumPoint[]
  end: number
  turns: number
}

const uuid = (rng: Random) =>
  [rng.hex(8), rng.hex(4), `4${rng.hex(3)}`, `a${rng.hex(3)}`, rng.hex(12)].join('-')

const round = (value: number, places: number) => Number(value.toFixed(places))

const cost = (model: ModelId, usage: Record<keyof (typeof prices)[ModelId], number>) => {
  const price = prices[model]
  const dollars =
    (usage.input * price.input +
      usage.output * price.output +
      usage.cacheRead * price.cacheRead +
      usage.cacheCreation * price.cacheCreation) /
    1_000_000
  return round(dollars, 7)
}

function identity(account: AccountKey): Attributes {
  const a = demoAccounts[account]
  return {
    'user.id': a.userId,
    'user.email': a.email,
    'user.account_uuid': a.accountUuid,
    'user.account_id': a.accountId,
    ...(a.organizationId === undefined ? {} : { 'organization.id': a.organizationId }),
    'terminal.type': 'vscode',
  }
}

const linkKeys = {
  groupId: 'embertrail.group.id',
  groupKind: 'embertrail.group.kind',
  parentId: 'embertrail.parent.session_id',
  role: 'embertrail.role',
} as const

function linkAttributes(link: Link): Record<string, string> {
  const found: Record<string, string> = {}
  for (const [field, key] of Object.entries(linkKeys)) {
    const value = link[field as keyof Link]
    if (value !== undefined) found[key] = value
  }
  return found
}

/** One Session's turns, until `now`: a prompt, requests and tool calls, then a flush of deltas. */
function simulate(rng: Random, plan: Plan, now: number): Run {
  const events: EventRecord[] = []
  const points: SumPoint[] = []
  const who = identity(plan.account)
  const base = { 'session.id': plan.id, ...who }
  let cursor = plan.start
  let turns = 0

  for (let turn = 0; turn < plan.turns && cursor < now; turn += 1) {
    const started = cursor
    const promptId = uuid(rng)
    const turnEvents: EventRecord[] = []
    const turnPoints: SumPoint[] = []
    let t = started
    const event = (name: string, attributes: Attributes) =>
      turnEvents.push({ time: t, name, attributes: { ...base, ...attributes } })

    event('user_prompt', {
      'prompt.id': promptId,
      prompt_length: rng.int(20, 900),
      prompt: '<REDACTED>',
      'message.uuid': uuid(rng),
    })

    const usage = new Map<string, number>()
    const spend = new Map<string, number>()
    const request = (model: ModelId, source: 'main' | 'auxiliary') => {
      const tokens =
        source === 'main'
          ? {
              input: rng.int(2, 40),
              output: rng.int(80, 900),
              cacheRead: rng.int(8_000, 80_000),
              cacheCreation: rng.int(500, 6_000),
            }
          : { input: rng.int(300, 1_200), output: rng.int(20, 120), cacheRead: 0, cacheCreation: 0 }
      const dollars = cost(model, tokens)
      const slow = rng.chance(0.04) ? 3 : 1
      const [low, high] =
        model === 'claude-opus-4-7'
          ? [2_500, 9_000]
          : model === 'claude-sonnet-4-6'
            ? [1_500, 6_000]
            : [400, 1_800]
      t += rng.int(150, 500)
      event('api_request', {
        'prompt.id': promptId,
        model,
        cost_usd: dollars,
        cost_usd_micros: Math.round(dollars * 1_000_000),
        duration_ms: rng.int(low, high) * slow,
        ttft_ms: rng.int(300, 1_800),
        input_tokens: tokens.input,
        output_tokens: tokens.output,
        cache_read_tokens: tokens.cacheRead,
        cache_creation_tokens: tokens.cacheCreation,
        request_id: `req_${rng.hex(16)}`,
        query_source: source,
      })
      spend.set(`${model}|${source}`, (spend.get(`${model}|${source}`) ?? 0) + dollars)
      for (const [type, count] of Object.entries(tokens)) {
        const key = `${model}|${source}|${type}`
        usage.set(key, (usage.get(key) ?? 0) + count)
      }
    }

    if (rng.chance(0.06)) {
      t += rng.int(100, 300)
      const status = rng.weighted([
        [529, 3],
        [500, 1],
        [429, 2],
      ])
      event('api_error', {
        'prompt.id': promptId,
        model: plan.model,
        error: status === 429 ? 'Rate limited' : 'Overloaded',
        status_code: status,
        duration_ms: rng.int(800, 3_000),
        attempt: 1,
        request_id: `req_${rng.hex(16)}`,
      })
    }
    request(plan.model, 'main')

    let edits = 0
    const decisions = new Map<string, number>()
    const language = rng.pick(['TypeScript', 'Python', 'Markdown', 'Rust'])
    for (let n = rng.int(0, 4); n > 0; n -= 1) {
      const tool = rng.weighted(tools)
      const useId = `toolu_${rng.hex(16)}`
      const accepted = rng.chance(editTools.has(tool) ? 0.85 : 0.97)
      t += rng.int(40, 300)
      event('tool_decision', {
        'prompt.id': promptId,
        tool_name: tool,
        tool_use_id: useId,
        decision: accepted ? 'accept' : 'reject',
        tool_source: 'builtin',
        source: 'config',
      })
      if (editTools.has(tool)) {
        const key = `${tool}|${accepted ? 'accept' : 'reject'}`
        decisions.set(key, (decisions.get(key) ?? 0) + 1)
      }
      if (!accepted) continue
      t += rng.int(20, 400)
      const success = !rng.chance(failureRate[tool] ?? 0.03)
      if (success && editTools.has(tool)) edits += 1
      event('tool_result', {
        'prompt.id': promptId,
        tool_name: tool,
        tool_use_id: useId,
        success,
        duration_ms: rng.int(5, 900),
        decision_type: 'accept',
        decision_source: 'config',
        tool_input_size_bytes: rng.int(40, 900),
        tool_result_size_bytes: rng.int(100, 20_000),
      })
    }
    if (rng.chance(0.2)) request('claude-haiku-4-5', 'auxiliary')

    const finished = Math.max(t + 1_000, started + rng.int(25, 140) * 1_000)
    if (finished > now) break

    const point = (metric: string, unit: string, attributes: Attributes, value: number) =>
      turnPoints.push({
        metric: `claude_code.${metric}`,
        unit,
        attributes: { ...base, ...attributes },
        start: started,
        time: finished,
        value,
      })
    if (turn === 0) {
      turnPoints.push({
        metric: 'claude_code.session.count',
        unit: '',
        attributes: { ...base, start_type: plan.startType },
        start: started,
        time: started + 500,
        value: 1,
      })
    }
    for (const [key, tokens] of usage) {
      const [model, source, type] = key.split('|') as [string, string, string]
      point(
        'token.usage',
        'tokens',
        { type, model, query_source: source, speed: 'normal', effort: 'high' },
        tokens,
      )
    }
    for (const [key, dollars] of spend) {
      const [model, source] = key.split('|') as [string, string]
      point(
        'cost.usage',
        'USD',
        { model, query_source: source, speed: 'normal', effort: 'high' },
        round(dollars, 7),
      )
    }
    point('active_time.total', 's', { type: 'user' }, round(rng.int(40, 450) / 10, 1))
    point('active_time.total', 's', { type: 'cli' }, round(((finished - started) / 1_000) * 0.8, 1))
    if (edits > 0) {
      point('lines_of_code.count', '', { type: 'added', model: plan.model }, rng.int(2, 40) * edits)
      if (rng.chance(0.7)) {
        point(
          'lines_of_code.count',
          '',
          { type: 'removed', model: plan.model },
          rng.int(1, 15) * edits,
        )
      }
      if (rng.chance(0.15)) point('commit.count', '', {}, 1)
    }
    for (const [key, count] of decisions) {
      const [tool, decision] = key.split('|') as [string, string]
      point(
        'code_edit_tool.decision',
        '',
        { tool_name: tool, decision, source: 'config', language },
        count,
      )
    }

    events.push(...turnEvents)
    points.push(...turnPoints)
    turns += 1
    cursor = finished + rng.int(15, 240) * 1_000
  }

  const last = points.reduce((end, point) => Math.max(end, point.time), plan.start)
  return { plan, events, points, end: last, turns }
}

interface GroupNode {
  role: string
  turns: number
  children?: GroupNode[]
  /** Moves this Session to another group by Label. */
  moveTo?: string
}

interface GroupBlueprint {
  id: string
  kind: string
  daysAgo: number
  tree: GroupNode
}

// Three Session Groups: a 3 level orchestrator run, a 2 level batch and a smaller orchestrator run.
// A Label then moves one Session from the first group to the second.
const groupBlueprints: GroupBlueprint[] = [
  {
    id: 'billing-migration',
    kind: 'orchestrator',
    daysAgo: 2,
    tree: {
      role: 'orchestrator',
      turns: 7,
      children: [
        {
          role: 'worker',
          turns: 5,
          children: [
            { role: 'subagent', turns: 3 },
            { role: 'subagent', turns: 3 },
          ],
        },
        { role: 'worker', turns: 5, children: [{ role: 'subagent', turns: 2 }] },
        { role: 'worker', turns: 4, moveTo: 'docs-sweep' },
      ],
    },
  },
  {
    id: 'docs-sweep',
    kind: 'batch',
    daysAgo: 9,
    tree: {
      role: 'orchestrator',
      turns: 6,
      children: [
        { role: 'worker', turns: 4 },
        { role: 'worker', turns: 3 },
        { role: 'worker', turns: 4 },
      ],
    },
  },
  {
    id: 'flaky-tests',
    kind: 'orchestrator',
    daysAgo: 16,
    tree: {
      role: 'orchestrator',
      turns: 6,
      children: [
        { role: 'worker', turns: 5, children: [{ role: 'subagent', turns: 2 }] },
        { role: 'worker', turns: 4 },
      ],
    },
  },
]

const minutes = (value: number) => value * 60_000

function groupPlans(
  rng: Random,
  tz: string,
  today: CalendarDate,
  days: number,
): { plans: Plan[]; roots: Map<string, string>; kinds: Map<string, string> } {
  const plans: Plan[] = []
  const roots = new Map<string, string>()
  const kinds = new Map<string, string>()
  for (const blueprint of groupBlueprints) {
    if (blueprint.daysAgo >= days) continue
    const day = addDays(today, -blueprint.daysAgo)
    const begin = zonedTime(tz, day, 10).getTime()
    kinds.set(blueprint.id, blueprint.kind)
    const visit = (node: GroupNode, start: number, parentId: string | undefined) => {
      const id = uuid(rng)
      if (parentId === undefined) roots.set(blueprint.id, id)
      plans.push({
        id,
        start,
        account: 'work',
        startType: 'fresh',
        turns: node.turns,
        model: node.role === 'subagent' ? 'claude-sonnet-4-6' : 'claude-opus-4-7',
        emitted: {
          groupId: blueprint.id,
          groupKind: blueprint.kind,
          role: node.role,
          ...(parentId === undefined ? {} : { parentId }),
        },
        ...(node.moveTo === undefined ? {} : { labels: { groupId: node.moveTo } }),
      })
      node.children?.forEach((child, index) => {
        visit(child, start + minutes(25 * (index + 1)), id)
      })
    }
    visit(blueprint.tree, begin, undefined)
  }
  // A moved Session joins its new group's root and takes its kind with it.
  for (const plan of plans) {
    const to = plan.labels?.groupId
    if (to === undefined) continue
    const root = roots.get(to)
    if (root === undefined) {
      delete plan.labels
      continue
    }
    plan.labels = {
      groupId: to,
      groupKind: kinds.get(to) ?? 'batch',
      parentId: root,
      role: 'worker',
    }
  }
  return { plans, roots, kinds }
}

function ordinaryPlans(rng: Random, tz: string, today: CalendarDate, days: number): Plan[] {
  const plans: Plan[] = []
  for (let back = days - 1; back >= 0; back -= 1) {
    const day = addDays(today, -back)
    const dow = new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay()
    const weekend = dow === 0 || dow === 6
    const count = weekend ? (rng.chance(0.35) ? 1 : 0) : rng.int(4, 7)
    const starts = Array.from({ length: count }, () => {
      const [from, to] = rng.weighted([
        [[8 * 60 + 30, 12 * 60], 5],
        [[13 * 60, 17 * 60 + 30], 5],
        [[20 * 60, 22 * 60], 1.5],
      ] as const)
      return rng.int(from, to)
    })
    const times = starts
      .sort((a, b) => a - b)
      .map((minuteOfDay) => ({
        start: zonedTime(tz, day, Math.floor(minuteOfDay / 60), minuteOfDay % 60).getTime(),
        minuteOfDay,
        turns: rng.chance(0.1) ? rng.int(10, 16) : rng.int(2, 9),
      }))
    // On a day with a clock change, one long Session starts just before it and runs across.
    const bounds = dayBounds(tz, day)
    const change = offsetChange(tz, bounds.from, bounds.to)
    if (change !== undefined) {
      times.unshift({ start: change.getTime() - minutes(6), minuteOfDay: 2 * 60, turns: 12 })
    }
    for (const { start, minuteOfDay, turns } of times) {
      const evening = minuteOfDay >= 18 * 60
      const work = rng.chance(!weekend && !evening ? 0.85 : 0.25)
      plans.push({
        id: uuid(rng),
        start,
        account: work ? 'work' : 'personal',
        startType: rng.chance(0.85) ? 'fresh' : 'resume',
        turns,
        model: rng.weighted([
          ['claude-opus-4-7', 45],
          ['claude-sonnet-4-6', 45],
          ['claude-haiku-4-5', 10],
        ]),
        emitted: {},
      })
    }
  }
  return plans
}

const sum = (values: Iterable<number>) => {
  let total = 0
  for (const value of values) total += value
  return total
}

function otherSender(rng: Random, tz: string, today: CalendarDate, days: number, now: number) {
  const events: EventRecord[] = []
  const points: SumPoint[] = []
  for (let back = Math.min(days, 10) - 1; back >= 0; back -= 1) {
    const day = addDays(today, -back)
    for (let n = 0; n < rng.int(2, 5); n += 1) {
      const time = zonedTime(tz, day, rng.int(9, 17), rng.int(0, 59)).getTime()
      if (time >= now) continue
      const session = `other-${rng.hex(12)}`
      events.push({
        time,
        name: 'request_finished',
        attributes: {
          'session.id': session,
          model: 'other-model-1',
          duration_ms: rng.int(200, 4_000),
        },
      })
      points.push({
        metric: 'other_agent.requests',
        unit: '',
        attributes: { 'session.id': session },
        start: time - 1_000,
        time,
        value: 1,
      })
    }
  }
  return { events, points }
}

/** The dataset for these options. */
export function demoDataset(options: DemoOptions = {}): DemoDataset {
  const resolved: Required<DemoOptions> = {
    now: options.now ?? demoNow,
    tz: options.tz ?? 'Europe/Berlin',
    days: options.days ?? 35,
    seed: options.seed ?? 1,
    sender: options.sender ?? 'claude-code',
  }
  const { now, tz, days, seed, sender } = resolved
  const rng = createRandom(seed)
  const today = localDate(tz, now)
  const todayBounds = dayBounds(tz, today)
  const weekBounds = { from: zonedTime(tz, weekStart(today)), to: todayBounds.to }
  const windows = {
    today: { from: todayBounds.from.toISOString(), to: todayBounds.to.toISOString() },
    thisWeek: { from: weekBounds.from.toISOString(), to: weekBounds.to.toISOString() },
  }
  const emptyFacts: DemoFacts = {
    ...windows,
    sessions: 0,
    sessionsToday: 0,
    cost: 0,
    costToday: 0,
    costThisWeek: 0,
    costByModel: {},
    costByAccount: { work: 0, personal: 0 },
    eventCount: 0,
    pointCount: 0,
    eventsByName: {},
    commits: 0,
    apiErrors: 0,
    toolFailures: 0,
    sessionFacts: [],
    groups: [],
  }

  if (sender === 'other') {
    const { events, points } = otherSender(rng, tz, today, days, now.getTime())
    const resource = {}
    return {
      options: resolved,
      otlp: [
        {
          path: '/v1/logs',
          body: logsRequest('other-agent', resource, events, 'other-agent', 'other_agent'),
        },
        {
          path: '/v1/metrics',
          body: metricsRequest('other-agent', resource, points, 'other-agent'),
        },
      ],
      labels: [],
      facts: { ...emptyFacts, eventCount: events.length, pointCount: points.length },
    }
  }

  const grouped = groupPlans(rng, tz, today, days)
  const ordinary = ordinaryPlans(rng, tz, today, days)
  // A plain Session that a Label then pulls into the last group.
  const lateFix = zonedTime(tz, addDays(today, -4), 15).getTime()
  const flakyRoot = grouped.roots.get('flaky-tests')
  const late: Plan[] =
    flakyRoot === undefined || days <= 4
      ? []
      : [
          {
            id: uuid(rng),
            start: lateFix,
            account: 'work',
            startType: 'fresh',
            turns: 4,
            model: 'claude-sonnet-4-6',
            emitted: {},
            labels: {
              groupId: 'flaky-tests',
              groupKind: 'orchestrator',
              parentId: flakyRoot,
              role: 'worker',
            },
          },
        ]

  const runs = [...ordinary, ...late, ...grouped.plans]
    .map((plan) => simulate(rng, plan, now.getTime()))
    .filter((run) => run.turns > 0)
    .sort((a, b) => a.plan.start - b.plan.start)

  const otlp: OtlpRequest[] = []
  const labels: SessionLabels[] = []
  for (const run of runs) {
    const resource = linkAttributes(run.plan.emitted)
    otlp.push(
      { path: '/v1/logs', body: logsRequest('claude-code', resource, run.events) },
      { path: '/v1/metrics', body: metricsRequest('claude-code', resource, run.points) },
    )
    if (run.plan.labels !== undefined) {
      labels.push({ sessionId: run.plan.id, labels: linkAttributes(run.plan.labels) })
    }
  }

  const inside = (time: number, bounds: { from: Date; to: Date }) =>
    time >= bounds.from.getTime() && time < bounds.to.getTime()
  const allPoints = runs.flatMap((run) => run.points.map((point) => ({ run, point })))
  const costPoints = allPoints.filter(({ point }) => point.metric === 'claude_code.cost.usage')
  const costOf = (points: typeof costPoints) => sum(points.map(({ point }) => point.value))
  const costByModel: Record<string, number> = {}
  const costByAccount: Record<AccountKey, number> = { work: 0, personal: 0 }
  for (const { run, point } of costPoints) {
    const model = String(point.attributes.model)
    costByModel[model] = (costByModel[model] ?? 0) + point.value
    costByAccount[run.plan.account] += point.value
  }
  const eventsByName: Record<string, number> = {}
  const events = runs.flatMap((run) => run.events)
  for (const event of events) eventsByName[event.name] = (eventsByName[event.name] ?? 0) + 1

  const sessionFacts = runs.map((run): DemoSessionFact => {
    const spent = sum(
      run.points.filter((p) => p.metric === 'claude_code.cost.usage').map((p) => p.value),
    )
    return {
      id: run.plan.id,
      start: new Date(run.plan.start).toISOString(),
      end: new Date(run.end).toISOString(),
      account: run.plan.account,
      model: run.plan.model,
      turns: run.turns,
      cost: spent,
      emitted: run.plan.emitted,
      effective: { ...run.plan.emitted, ...run.plan.labels },
    }
  })

  const members = new Map<string, DemoSessionFact[]>()
  for (const fact of sessionFacts) {
    const id = fact.effective.groupId
    if (id !== undefined) members.set(id, [...(members.get(id) ?? []), fact])
  }
  const groups = [...members.entries()].map(([id, group]): DemoGroupFact => {
    const ids = new Set(group.map((m) => m.id))
    const parent = new Map(group.map((m) => [m.id, m.effective.parentId]))
    const levels = (sessionId: string): number => {
      const up = parent.get(sessionId)
      return up !== undefined && ids.has(up) ? 1 + levels(up) : 1
    }
    return {
      id,
      kind: group.find((m) => m.effective.groupKind !== undefined)?.effective.groupKind ?? 'batch',
      sessionIds: [...group].sort((a, b) => levels(a.id) - levels(b.id)).map((m) => m.id),
      rootIds: group
        .filter((m) => m.effective.parentId === undefined || !ids.has(m.effective.parentId))
        .map((m) => m.id),
      depth: Math.max(...group.map((m) => levels(m.id))),
      cost: sum(group.map((m) => m.cost)),
    }
  })

  const moved = sessionFacts.find(
    (fact) => fact.emitted.groupId !== undefined && fact.effective.groupId !== fact.emitted.groupId,
  )

  return {
    options: resolved,
    otlp,
    labels,
    facts: {
      ...windows,
      sessions: runs.length,
      sessionsToday: sum(
        allPoints
          .filter(
            ({ point }) =>
              point.metric === 'claude_code.session.count' && inside(point.time, todayBounds),
          )
          .map(({ point }) => point.value),
      ),
      cost: costOf(costPoints),
      costToday: costOf(costPoints.filter(({ point }) => inside(point.time, todayBounds))),
      costThisWeek: costOf(costPoints.filter(({ point }) => inside(point.time, weekBounds))),
      costByModel,
      costByAccount,
      eventCount: events.length,
      pointCount: allPoints.length,
      eventsByName,
      commits: sum(
        allPoints
          .filter(({ point }) => point.metric === 'claude_code.commit.count')
          .map(({ point }) => point.value),
      ),
      apiErrors: eventsByName.api_error ?? 0,
      toolFailures: events.filter((e) => e.name === 'tool_result' && e.attributes.success === false)
        .length,
      sessionFacts,
      groups,
      ...(moved?.emitted.groupId === undefined || moved.effective.groupId === undefined
        ? {}
        : {
            relabelled: {
              sessionId: moved.id,
              from: moved.emitted.groupId,
              to: moved.effective.groupId,
            },
          }),
    },
  }
}
