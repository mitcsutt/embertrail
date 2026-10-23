import type { QueryContext } from '#features/filters/types/filters'
import {
  attributeKeyPattern,
  comparisonOps,
  eventAggregations,
  maxGroupBy,
  maxLimit,
  maxMembers,
  maxNameLength,
  maxQueryFilters,
  membershipOps,
  metricAggregations,
  presenceOps,
  queryBuckets,
} from '#features/widgets/constants/queryOptions'
import type { QueryIssue, QueryWidgetConfig } from '#features/widgets/types/queryWidget'
import type { WidgetKind, WidgetRequest } from '#features/widgets/types/widget'

type Ops = readonly string[]
const has = (list: Ops, value: unknown) => typeof value === 'string' && list.includes(value)

const keyProblem = (key: unknown): string | undefined =>
  typeof key === 'string' && attributeKeyPattern.test(key)
    ? undefined
    : 'A key starts with a letter or underscore and holds letters, digits and . _ - / (128 characters at most).'

/**
 * What is wrong with a Query Widget's configuration, in terms of the Query API's rules. An empty
 * answer means `buildQueryRequest` produces a request the spec accepts. A Board document is data
 * the Hub stored, so this takes whatever shape arrives and checks it rather than trusting it.
 */
export function validateQueryConfig(config: QueryWidgetConfig): QueryIssue[] {
  const issues: QueryIssue[] = []
  const add = (field: QueryIssue['field'], message: string) => issues.push({ field, message })

  const { source } = config
  if (source.kind === 'metric') {
    if (source.name.trim() === '') add('source', 'Pick a Metric.')
    else if (source.name.length > maxNameLength) {
      add('source', `A Metric name is ${String(maxNameLength)} characters at most.`)
    }
    if (!has(metricAggregations, source.aggregation)) add('aggregation', 'Pick an aggregation.')
  } else {
    if (source.name.trim() === '') add('source', 'Pick an Event.')
    else if (source.name.length > maxNameLength) {
      add('source', `An Event name is ${String(maxNameLength)} characters at most.`)
    }
    const { fn, key } = source.aggregation
    if (!has(eventAggregations, fn)) {
      add('aggregation', 'Pick an aggregation.')
    } else if (fn === 'count') {
      if (key !== undefined) add('aggregation', 'Counting Events takes no key.')
    } else if (key === undefined || key === '') {
      add('aggregation', `${fn} needs the attribute to aggregate.`)
    } else {
      const problem = keyProblem(key)
      if (problem !== undefined) add('aggregation', problem)
    }
  }

  if (config.groupBy.length > maxGroupBy) {
    add('groupBy', `Group by at most ${String(maxGroupBy)} keys.`)
  }
  if (new Set(config.groupBy).size !== config.groupBy.length) {
    add('groupBy', 'Each key can be grouped by once.')
  }
  for (const key of config.groupBy) {
    const problem = keyProblem(key)
    if (problem !== undefined) add('groupBy', `"${key}": ${problem}`)
  }

  if (config.bucket !== undefined && !queryBuckets.includes(config.bucket)) {
    add('bucket', 'Pick minute, hour, day, week or month.')
  }

  if (config.filter.length > maxQueryFilters) {
    add('filter', `Use at most ${String(maxQueryFilters)} filters.`)
  }
  for (const entry of config.filter) {
    const problem = keyProblem(entry.key)
    if (problem !== undefined) add('filter', `"${entry.key}": ${problem}`)
    if (has(comparisonOps, entry.op)) {
      const value: unknown = (entry as { value?: unknown }).value
      if (!['string', 'number', 'boolean'].includes(typeof value)) {
        add('filter', `${entry.key} ${entry.op} needs a value.`)
      } else if (typeof value === 'number' && !Number.isFinite(value)) {
        add('filter', `${entry.key} ${entry.op} needs a finite number.`)
      }
    } else if (has(membershipOps, entry.op)) {
      const value: unknown = (entry as { value?: unknown }).value
      if (!Array.isArray(value) || value.length === 0) {
        add('filter', `${entry.key} ${entry.op} needs at least one value.`)
      } else if (value.length > maxMembers) {
        add('filter', `${entry.key} ${entry.op} takes ${String(maxMembers)} values at most.`)
      } else if (value.some((member) => !['string', 'number', 'boolean'].includes(typeof member))) {
        add('filter', `${entry.key} ${entry.op} takes text, numbers or booleans.`)
      }
    } else if (!has(presenceOps, entry.op)) {
      add('filter', `${entry.key}: pick an operator.`)
    }
  }

  if (config.limit !== undefined) {
    if (!Number.isInteger(config.limit) || config.limit < 1 || config.limit > maxLimit) {
      add('limit', `The limit is a whole number from 1 to ${maxLimit.toLocaleString('en')}.`)
    }
  }

  const unavailable = chartAvailability(config)[config.chart]
  if (unavailable !== undefined) add('chart', unavailable)
  return issues
}

/**
 * For each chart kind, why it cannot draw the rows this shape (a time bucket and group keys) gives,
 * or `undefined` when it can. The editor disables a kind with the reason beside it.
 */
export function chartAvailability(
  shape: Pick<QueryWidgetConfig, 'groupBy' | 'bucket'>,
): Record<WidgetKind, string | undefined> {
  const grouped = shape.groupBy.length > 0
  const timed = shape.bucket !== undefined
  const ranks = (what: string) =>
    timed
      ? `${what} ranks groups, so it cannot be split by time: remove the time bucket.`
      : grouped
        ? undefined
        : `${what} needs a Group by key to rank.`
  return {
    stat:
      timed || grouped
        ? 'A stat shows one number: remove the time bucket and the Group by keys.'
        : undefined,
    series: timed ? undefined : 'A line needs a time bucket.',
    bars: timed || grouped ? undefined : 'Bars need a time bucket or a Group by key.',
    'bar-list': ranks('A bar list'),
    share: ranks('A share chart'),
    table: undefined,
    heatmap:
      shape.bucket !== 'hour'
        ? 'A heatmap needs the hour bucket.'
        : grouped
          ? 'A heatmap cannot be split by group: remove the Group by keys.'
          : undefined,
  }
}

/** Thrown for a configuration that would not make a valid request; `issues` says why. */
export class InvalidQueryError extends Error {
  constructor(readonly issues: readonly QueryIssue[]) {
    super(issues.map((issue) => issue.message).join(' '))
    this.name = 'InvalidQueryError'
  }
}

/**
 * The Query API request for a Query Widget in this window. It never returns one the spec would
 * refuse: a configuration `validateQueryConfig` objects to throws `InvalidQueryError` instead.
 *
 * A Board's Source, Account and model filters (`ctx.filter`) join the Widget's own. With no time
 * bucket and a limit, rows are ranked by value so the limit keeps the largest (a top-N); in any
 * other case the Hub's default order applies, so a limit never drops the newest buckets silently
 * unless the author asked for it.
 */
export function buildQueryRequest(config: QueryWidgetConfig, ctx: QueryContext): WidgetRequest {
  const issues = validateQueryConfig(config)
  if (issues.length > 0) throw new InvalidQueryError(issues)

  const { source, groupBy, bucket, limit } = config
  const ranked = limit !== undefined && bucket === undefined && groupBy.length > 0
  const shape = {
    from: ctx.from,
    to: ctx.to,
    tz: ctx.tz,
    ...(bucket !== undefined && { bucket }),
    ...(groupBy.length > 0 && { group_by: groupBy }),
    ...(ranked && { order: { by: 'value' as const, direction: 'desc' as const } }),
    ...(limit !== undefined && { limit }),
  }

  if (source.kind === 'metric') {
    const filter = [...config.filter, ...ctx.filter]
    return {
      op: 'queryMetrics',
      body: {
        metric: source.name,
        aggregation: source.aggregation,
        ...shape,
        ...(filter.length > 0 && { filter }),
      },
    }
  }
  const { fn, key } = source.aggregation
  return {
    op: 'queryEvents',
    body: {
      mode: 'aggregate',
      ...shape,
      filter: [
        { key: 'event.name', op: 'eq', value: source.name },
        ...config.filter,
        ...ctx.filter,
      ],
      aggregation: key === undefined ? { fn: fn as 'count' } : { fn: fn as 'sum', key },
    },
  }
}
