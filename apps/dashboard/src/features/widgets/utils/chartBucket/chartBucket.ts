import type { QueryContext } from '#features/filters/types/filters'

const dayMs = 86_400_000

/**
 * The bucket a time chart over this window should ask for: hours for a day or two, days beyond.
 * Empty buckets are omitted and charts space their points evenly, so hourly points over a week
 * would be mostly gaps.
 */
export function chartBucket(ctx: Pick<QueryContext, 'from' | 'to'>): 'hour' | 'day' {
  // Two days plus an hour, so a window across a clock change still counts as two days.
  const span = Date.parse(ctx.to) - Date.parse(ctx.from)
  return span <= 2 * dayMs + 3_600_000 ? 'hour' : 'day'
}
