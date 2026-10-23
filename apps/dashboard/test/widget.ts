// The template for a Widget's test (docs/dashboard.md, "Writing a Widget"): build a QueryContext,
// check the request against the spec, send it through the real client to a seeded test Hub, and
// select its data. A Widget's test file then asserts the data against the generator's known facts
// and, on a Hub holding only a non-Claude sender, that the Widget is empty.

import type { EmbertrailClient } from '@mitcsutt/embertrail-client'

import type { BoardFilters, QueryContext } from '#features/filters/types/filters'
import { toQueryContext, type WidgetScope } from '#features/filters/utils/toQueryContext'
import { runRequest } from '#features/widgets/data/runRequest'
import type { WidgetDefinition } from '#features/widgets/types/widget'

import { assertSpecRequest } from './spec.ts'

/**
 * A Widget's QueryContext for tests, built by `toQueryContext` like the app builds it (the one
 * owner, in `features/filters`). The Board's range is the last 90 days, which holds the whole demo
 * dataset; a Widget with a fixed window gets its own. `filters` are the Board's filters on top.
 */
export function testContext(
  widget: WidgetScope,
  now: Date,
  filters: Partial<BoardFilters> = {},
): QueryContext {
  return toQueryContext(
    { time: { kind: 'relative', range: 'last-90-days' }, ...filters },
    undefined,
    widget,
    now,
    'Europe/Berlin',
  )
}

/** Runs the Widget the way the app does and returns what its `select` makes of the response. */
export async function loadWidget<Data>(
  client: EmbertrailClient,
  definition: WidgetDefinition<Data>,
  ctx: QueryContext,
): Promise<Data> {
  const request = definition.request(ctx)
  assertSpecRequest(request)
  return definition.select(await runRequest(client, request), ctx)
}
