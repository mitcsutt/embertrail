import { BarList } from '@mitcsutt/kiln-charts'

import type { WidgetDefinition } from '#features/widgets/types/widget'
import { valuedRows, groupLabel } from '#features/widgets/utils/aggregateRows'

export interface ToolCount {
  tool: string
  calls: number
}

export interface TopToolsData {
  tools: ToolCount[]
}

export const topTools: WidgetDefinition<TopToolsData> = {
  id: 'top-tools',
  group: 'tools',
  title: 'Top tools',
  description: 'The tools Claude called most.',
  kind: 'bar-list',
  size: { w: 4, h: 4 },
  minSize: { w: 3, h: 3 },
  window: 'board',
  // `tool_result` Events carry no model.
  filters: ['source', 'account'],
  request: (ctx) => ({
    op: 'queryEvents',
    body: {
      mode: 'aggregate',
      from: ctx.from,
      to: ctx.to,
      tz: ctx.tz,
      filter: [{ key: 'event.name', op: 'eq', value: 'tool_result' }, ...ctx.filter],
      aggregation: { fn: 'count' },
      group_by: ['tool_name'],
      order: { by: 'value', direction: 'desc' },
      limit: 10,
    },
  }),
  select: (response) => ({
    tools: valuedRows(response).map((row) => ({
      tool: groupLabel(row, 'tool_name'),
      calls: row.value,
    })),
  }),
  isEmpty: ({ tools }) => tools.length === 0,
  View: ({ data, label }) => (
    <BarList
      data={data.tools.map((tool) => ({ ...tool }))}
      pivot={{ by: 'tool', value: 'calls' }}
      label={label}
      format="integer"
      max={10}
    />
  ),
}
