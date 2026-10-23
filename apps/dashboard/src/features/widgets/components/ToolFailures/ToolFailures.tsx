import { Table } from '@mitcsutt/kiln-ui'

import type { WidgetDefinition } from '#features/widgets/types/widget'
import { aggregateRows } from '#features/widgets/utils/aggregateRows'
import { formatPercent } from '#features/widgets/utils/formats'

export interface ToolOutcome {
  tool: string
  calls: number
  failures: number
}

export interface ToolFailuresData {
  tools: ToolOutcome[]
}

export const toolFailures: WidgetDefinition<ToolFailuresData> = {
  id: 'tool-failures',
  group: 'tools',
  title: 'Tool failures',
  description: 'How often each tool failed.',
  kind: 'table',
  size: { w: 4, h: 4 },
  minSize: { w: 3, h: 3 },
  window: 'board',
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
      group_by: ['tool_name', 'success'],
    },
  }),
  select: (response) => {
    // One row per tool and outcome, pivoted into one row per tool.
    const byTool = new Map<string, ToolOutcome>()
    for (const row of aggregateRows(response)) {
      if (row.value === null) continue
      const tool = String(row.group.tool_name ?? 'Unknown')
      const outcome = byTool.get(tool) ?? { tool, calls: 0, failures: 0 }
      outcome.calls += row.value
      if (String(row.group.success) === 'false') outcome.failures += row.value
      byTool.set(tool, outcome)
    }
    return {
      tools: [...byTool.values()].toSorted(
        (a, b) => b.failures / b.calls - a.failures / a.calls || b.calls - a.calls,
      ),
    }
  },
  isEmpty: ({ tools }) => tools.length === 0,
  View: ({ data, label }) => (
    <Table label={label} density="compact">
      <Table.Head>
        <Table.Row>
          <Table.HeaderCell>Tool</Table.HeaderCell>
          <Table.HeaderCell numeric>Calls</Table.HeaderCell>
          <Table.HeaderCell numeric>Failed</Table.HeaderCell>
          <Table.HeaderCell numeric>Failure rate</Table.HeaderCell>
        </Table.Row>
      </Table.Head>
      <Table.Body>
        {data.tools.map((tool) => (
          <Table.Row key={tool.tool}>
            <Table.Cell rowHeader>{tool.tool}</Table.Cell>
            <Table.Cell numeric>{tool.calls.toLocaleString()}</Table.Cell>
            <Table.Cell numeric>{tool.failures.toLocaleString()}</Table.Cell>
            <Table.Cell numeric>{formatPercent(tool.failures / tool.calls)}</Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table>
  ),
}
