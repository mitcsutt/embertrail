import { Link, Tag, Text, Tooltip, TreeTable } from '@mitcsutt/kiln-ui'
import type { TreeTableColumn } from '@mitcsutt/kiln-ui'
import { Link as RouterLink, useNavigate } from '@tanstack/react-router'
import { useMemo } from 'react'
import type { MouseEvent, ReactNode } from 'react'

import { useLocale } from '#features/locale/hooks/useLocale'
import { useMoney } from '#features/locale/hooks/useMoney'
import type { GroupNode, TreeNode } from '#features/sessions/types/sessionTree'
import { formatCount, formatTime, shortId } from '#features/sessions/utils/formats'

export interface SessionGroupTreeProps {
  groups: readonly GroupNode[]
  /** The zone times are written in. */
  tz: string
  /** The ids of the open rows (`rowId`s), so the page can keep them in the URL. */
  expanded: readonly string[]
  onExpandedChange: (expanded: string[]) => void
}

const columns: TreeTableColumn[] = [
  { id: 'name', header: 'Group or Session', width: 'fill' },
  { id: 'started', header: 'Started', width: 'min', hideBelow: 'md' },
  { id: 'models', header: 'Models', width: 'min', hideBelow: 'md' },
  { id: 'sessions', header: 'Sessions', numeric: true, width: 'min', hideBelow: 'sm' },
  { id: 'cost', header: 'Cost', numeric: true, width: 'min' },
  { id: 'tokens', header: 'Tokens', numeric: true, width: 'min', hideBelow: 'sm' },
]

const nameStyle = {
  display: 'inline-flex',
  alignItems: 'baseline',
  gap: 'var(--space-2)',
  minInlineSize: 0,
}

/** Text that clips to one line at `maxInlineSize`, with the whole of it in a tooltip on hover. */
function Clipped({ children, maxInlineSize }: { children: string; maxInlineSize: string }) {
  return (
    <Tooltip content={children}>
      <span style={{ display: 'block', maxInlineSize, minInlineSize: 0 }}>
        <Text as="span" truncate>
          {children}
        </Text>
      </span>
    </Tooltip>
  )
}

const flatten = (rows: readonly TreeNode[], into = new Map<string, TreeNode>()) => {
  for (const row of rows) {
    into.set(row.rowId, row)
    flatten(row.children, into)
  }
  return into
}

/**
 * Session Groups as a tree: a row per group with its totals, the Sessions of the group under it,
 * and each Session's children under that. A click anywhere on a group's row opens or closes it,
 * and on a Session's row opens the Session (its name is the link, so Enter does the same); a
 * Session with children opens them with the chevron or the arrow keys.
 */
export function SessionGroupTree({
  groups,
  tz,
  expanded,
  onExpandedChange,
}: SessionGroupTreeProps) {
  const money = useMoney()
  const { locale } = useLocale()
  const navigate = useNavigate()
  const byId = useMemo(() => flatten(groups), [groups])

  const toggle = (rowId: string) => {
    onExpandedChange(
      expanded.includes(rowId) ? expanded.filter((id) => id !== rowId) : [...expanded, rowId],
    )
  }
  const act = (row: TreeNode) => {
    if (row.kind === 'group') toggle(row.rowId)
    else void navigate({ to: '/sessions/$sessionId', params: { sessionId: row.session.id } })
  }
  const rowOf = (target: EventTarget): TreeNode | undefined => {
    const id = (target as Element).closest('tbody tr')?.querySelector('[data-row-id]')
    return byId.get(id?.getAttribute('data-row-id') ?? '')
  }

  const onClick = (event: MouseEvent) => {
    const target = event.target as Element
    // A link, the chevron and a text selection do their own thing.
    if (target.closest('a, button') || event.metaKey || event.ctrlKey || event.shiftKey) return
    if (window.getSelection()?.toString()) return
    const row = rowOf(target)
    if (row !== undefined) act(row)
  }

  const named = (row: TreeNode, content: ReactNode) => (
    <span data-row-id={row.rowId} style={nameStyle}>
      {content}
    </span>
  )

  const renderCell = (row: TreeNode, column: TreeTableColumn) => {
    if (row.kind === 'group') {
      switch (column.id) {
        case 'name':
          return named(
            row,
            row.groupId === null ? (
              <Text weight="strong">No group</Text>
            ) : (
              <>
                <Clipped maxInlineSize="min(24rem, 40vw)">{row.groupId}</Clipped>
                {row.groupKind === null ? null : <Tag>{row.groupKind}</Tag>}
              </>
            ),
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
        return named(
          row,
          <>
            <Link asChild>
              <RouterLink to="/sessions/$sessionId" params={{ sessionId: session.id }}>
                {shortId(session.id)}
              </RouterLink>
            </Link>
            {session.role === null ? null : <Tag>{session.role}</Tag>}
          </>,
        )
      case 'started':
        return (
          <Text as="span" style={{ whiteSpace: 'nowrap' }}>
            {formatTime(session.started_at, tz, {}, locale)}
          </Text>
        )
      case 'models':
        return session.models.length === 0 ? (
          '–'
        ) : (
          <Clipped maxInlineSize="14rem">{session.models.join(', ')}</Clipped>
        )
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
      columns={columns}
      rows={groups}
      getRowId={(row) => row.rowId}
      getChildren={(row) => (row.children.length > 0 ? row.children : undefined)}
      expanded={expanded}
      onExpandedChange={onExpandedChange}
      renderCell={renderCell}
      onClick={onClick}
    />
  )
}
