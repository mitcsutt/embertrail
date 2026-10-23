import { QueryWidgetView } from '#features/widgets/components/QueryWidgetView'
import type { QueryData, QueryWidgetConfig } from '#features/widgets/types/queryWidget'
import type { WidgetDefinition, WidgetKind } from '#features/widgets/types/widget'
import { isEmptyQueryData, selectQueryData } from '#features/widgets/utils/queryData'
import { buildQueryRequest } from '#features/widgets/utils/queryWidget'

const sizes: Record<WidgetKind, { w: number; h: number }> = {
  stat: { w: 3, h: 2 },
  series: { w: 6, h: 4 },
  bars: { w: 6, h: 4 },
  'bar-list': { w: 4, h: 4 },
  share: { w: 4, h: 4 },
  table: { w: 6, h: 4 },
  heatmap: { w: 5, h: 5 },
}

/** The Layout size a new Query Widget of this chart kind starts at. */
export const queryWidgetSize = (chart: WidgetKind) => sizes[chart]

/**
 * A Query Widget as a `WidgetDefinition`, so the one `Widget` path (`useWidgetData`, the frame, the
 * error state) runs it like a Catalogue entry. It is not in the Catalogue: a Board stores the
 * configuration, not an id. It honours all three Board filters, so a Board filtered by model
 * empties a Query Widget over a Metric or an Event that carries none (`session.count`,
 * `tool_result`); the Widget's own filters are the way to leave that out.
 */
export function queryWidgetDefinition(
  title: string,
  config: QueryWidgetConfig,
): WidgetDefinition<QueryData> {
  return {
    id: 'query',
    // Required by the contract, unused: a Query Widget never appears in the Catalogue's groups.
    group: 'spend',
    title,
    kind: config.chart,
    size: queryWidgetSize(config.chart),
    window: 'board',
    filters: ['source', 'account', 'model'],
    request: (ctx) => buildQueryRequest(config, ctx),
    select: (response, ctx) => selectQueryData(config, response, ctx),
    isEmpty: isEmptyQueryData,
    View: ({ data, label, ctx }) => <QueryWidgetView data={data} label={label} tz={ctx.tz} />,
  }
}
