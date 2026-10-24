import { Link, Tag, Text, TreeTable } from '@mitcsutt/kiln-ui'
import type { TreeTableColumn } from '@mitcsutt/kiln-ui'
import { Link as RouterLink } from '@tanstack/react-router'

import { useLocale } from '#features/locale/hooks/useLocale'
import { useMoney } from '#features/locale/hooks/useMoney'
import type { GroupNode, TreeNode } from '#features/sessions/types/sessionTree'
import { formatCount, formatTime, shortId } from '#features/sessions/utils/formats'

export interface SessionGroupTreeProps {
  groups: readonly GroupNode[]
  /** The zone times are written in. */
  tz: string
}

const columns: TreeTableColumn[] = [
  { id: 'name', header: 'Group or Session', width: 'fill' },
  { id: 'started', header: 'Started' },
  { id: 'models', header: 'Models' },
  { id: 'sessions', header: 'Sessions', numeric: true },
  { id: 'cost', header: 'Cost', numeric: true },
  { id: 'tokens', header: 'Tokens', numeric: true },
]

/**
 * Session Groups as a tree: a row per group with its totals, the Sessions of the group under it,
 * and each Session's children under that. The Session's name is its link to the Event timeline.
 */
export function SessionGroupTree({ groups, tz }: SessionGroupTreeProps) {
  const money = useMoney()
  const { locale } = useLocale()
  const renderCell = (row: TreeNode, column: TreeTableColumn) => {
    if (row.kind === 'group') {
      switch (column.id) {
        case 'name':
          return row.groupId === null ? (
            <Text weight="strong">No group</Text>
          ) : (
            <>
              <Text weight="strong">{row.groupId}</Text>
              {row.groupKind === null ? null : <Tag>{row.groupKind}</Tag>}
            </>
          )
        case 'sessions':
          return String(row.sessionCount)
        case 'cost':
          return money.format(row.cost)
        case 'tokens':
          return formatCount(row.tokens, locale)
        default:
          return null
      }
    }
    const { session } = row
    switch (column.id) {
      case 'name':
        return (
          <>
            <Link asChild>
              <RouterLink to="/sessions/$sessionId" params={{ sessionId: session.id }}>
                {shortId(session.id)}
              </RouterLink>
            </Link>
            {session.role === null ? null : <Tag>{session.role}</Tag>}
          </>
        )
      case 'started':
        return formatTime(session.started_at, tz, {}, locale)
      case 'models':
        return session.models.join(', ')
      case 'cost':
        return session.cost_usd === null ? '–' : money.format(session.cost_usd)
      case 'tokens':
        return formatCount(
          Object.values(session.tokens).reduce((a, b) => a + b, 0),
          locale,
        )
      default:
        return null
    }
  }

  return (
    <TreeTable<TreeNode>
      label="Session Groups"
      density="compact"
      columns={columns}
      rows={groups}
      getRowId={(row) => row.rowId}
      getChildren={(row) => (row.children.length > 0 ? row.children : undefined)}
      renderCell={renderCell}
    />
  )
}
