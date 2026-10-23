// The template for a Widget's test (docs/dashboard.md, "Writing a Widget"): build a QueryContext,
// check the request against the spec, send it through the real client to a seeded test Hub, and
// select its data. A Widget's test file then asserts the data against the generator's known facts
// and, on a Hub holding only a non-Claude sender, that the Widget is empty.

import type { EmbertrailClient } from '@mitcsutt/embertrail-client'

import type { QueryContext } from '#features/filters/types/filters'
import { runRequest } from '#features/widgets/data/runRequest'
import type { WidgetDefinition } from '#features/widgets/types/widget'

import { assertSpecRequest } from './spec.ts'

/** A QueryContext for tests: Berlin, no filters, and `now` at the end of the window. */
export function testContext(
  window: { from: string; to: string },
  rest: Partial<QueryContext> = {},
): QueryContext {
  return {
    tz: 'Europe/Berlin',
    filter: [],
    sessions: {},
    now: new Date(window.to),
    ...window,
    ...rest,
  }
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
