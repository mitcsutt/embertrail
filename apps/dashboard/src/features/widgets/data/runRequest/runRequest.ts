import type { EmbertrailClient } from '@mitcsutt/embertrail-client'

import type { WidgetRequest } from '#features/widgets/types/widget'

/** Sends a Widget's request through the client. The one place a Widget reaches the Hub. */
export function runRequest(
  client: EmbertrailClient,
  request: WidgetRequest,
  signal?: AbortSignal,
): Promise<unknown> {
  switch (request.op) {
    case 'queryMetrics':
      return client.queryMetrics({ body: request.body, signal })
    case 'queryMetricsEach':
      return Promise.all(request.bodies.map((body) => client.queryMetrics({ body, signal })))
    case 'queryEvents':
      return client.queryEvents({ body: request.body, signal })
    case 'listSessions':
      return client.listSessions({ query: request.query, signal })
  }
}
