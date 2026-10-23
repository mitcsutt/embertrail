import type { QueryBucket } from '#features/widgets/types/queryWidget'

// What the Query API accepts (spec/query-api.yaml), as the Query Widget editor offers it.

export const metricAggregations = ['sum', 'avg', 'min', 'max', 'count', 'last'] as const

export const eventAggregations = [
  'count',
  'count_distinct',
  'sum',
  'avg',
  'min',
  'max',
  'p50',
  'p90',
  'p95',
  'p99',
] as const

export const queryBuckets: readonly QueryBucket[] = ['minute', 'hour', 'day', 'week', 'month']

export const comparisonOps = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'] as const
export const membershipOps = ['in', 'not_in'] as const
export const presenceOps = ['exists', 'not_exists'] as const

/** A key to group or filter on: the spec's `AttributeKey`. */
export const attributeKeyPattern = /^[A-Za-z_][A-Za-z0-9_.\-/]{0,127}$/

export const maxGroupBy = 3
export const maxLimit = 10_000
/** A new Query Widget asks for this many rows at most: past 10,000 the Hub refuses (`too-many-rows`). */
export const defaultLimit = 1_000
/** A query holds 20 filters at most; the Board's Source, Account and model and an Event's name take four. */
export const maxQueryFilters = 16
export const maxMembers = 100
