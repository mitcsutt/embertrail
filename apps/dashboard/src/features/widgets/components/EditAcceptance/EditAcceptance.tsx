import { Share } from '@mitcsutt/kiln-charts'

import type { WidgetDefinition } from '#features/widgets/types/widget'
import { aggregateRows } from '#features/widgets/utils/aggregateRows'

export interface EditDecision {
  decision: string
  edits: number
}

export interface EditAcceptanceData {
  decisions: EditDecision[]
}

const labels = { accept: 'Accepted', reject: 'Rejected' }

export const editAcceptance: WidgetDefinition<EditAcceptanceData> = {
  id: 'edit-acceptance',
  group: 'tools',
  title: 'Edit acceptance',
  description: 'How many proposed edits you accepted and rejected.',
  kind: 'share',
  size: { w: 4, h: 4 },
  minSize: { w: 4, h: 3 },
  window: 'board',
  filters: ['source', 'account'],
  request: (ctx) => ({
    op: 'queryMetrics',
    body: {
      metric: 'claude_code.code_edit_tool.decision',
      aggregation: 'sum',
      from: ctx.from,
      to: ctx.to,
      tz: ctx.tz,
      group_by: ['decision'],
      ...(ctx.filter.length > 0 && { filter: ctx.filter }),
    },
  }),
  select: (response) => ({
    decisions: aggregateRows(response).flatMap((row) =>
      row.value === null
        ? []
        : [{ decision: String(row.group.decision ?? 'Unknown'), edits: row.value }],
    ),
  }),
  isEmpty: ({ decisions }) => decisions.length === 0,
  View: ({ data, label }) => (
    <Share
      data={data.decisions.map((decision) => ({ ...decision }))}
      pivot={{ by: 'decision', value: 'edits' }}
      label={label}
      height="fill"
      format="integer"
      labels={labels}
      totalLabel="edits"
    />
  ),
}
