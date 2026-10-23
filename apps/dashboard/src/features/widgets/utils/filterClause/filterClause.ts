import type { QueryContext } from '#features/filters/types/filters'

/** Spread into a request body: the Board's filters, left out when there are none. */
export function filterClause(ctx: Pick<QueryContext, 'filter'>): {
  filter?: QueryContext['filter']
} {
  return ctx.filter.length > 0 ? { filter: ctx.filter } : {}
}
