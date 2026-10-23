import { Share } from '@mitcsutt/kiln-charts'

import type { WidgetDefinition } from '#features/widgets/types/widget'
import { valuedRows, groupLabel } from '#features/widgets/utils/aggregateRows'
import { filterClause } from '#features/widgets/utils/filterClause'

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
      ...filterClause(ctx),
    },
  }),
  select: (response) => ({
    decisions: valuedRows(response).map((row) => ({
      decision: groupLabel(row, 'decision'),
      edits: row.value,
    })),
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
