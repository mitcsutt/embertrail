import { Alert, Button, Container, EmptyState, Skeleton, Stack, Text } from '@mitcsutt/kiln-ui'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useCallback, useMemo, useState } from 'react'

import { PageHeader } from '#components/PageHeader'
import { FilterBar } from '#features/filters/components/FilterBar'
import { useInventory } from '#features/filters/data/inventory'
import { useBoardFilters } from '#features/filters/hooks/useBoardFilters'
import { useQueryContext } from '#features/filters/hooks/useQueryContext'
import { useResolvedWindow } from '#features/filters/hooks/useResolvedWindow'
import type { BoardFilters } from '#features/filters/types/filters'
import { SessionGroupTree } from '#features/sessions/components/SessionGroupTree'
import { useSessionGroups } from '#features/sessions/data/sessionGroups'
import { groupSessions } from '#features/sessions/utils/groupSessions'
import { useHub } from '#lib/hub'

/** What a bare `/sessions` shows; the URL's filters win over it, as on a Board. */
const defaultFilters: BoardFilters = { time: { kind: 'relative', range: 'last-30-days' } }
const allFilters = { window: 'board', filters: ['source', 'account', 'model'] } as const

/** The open rows are `open` in the URL, so Back from a Session returns to the tree as it was. */
function useOpenRows(): [readonly string[], (open: string[]) => void] {
  const search: { open?: unknown } = useSearch({ strict: false })
  const navigate = useNavigate()
  const open = useMemo(
    () => (Array.isArray(search.open) ? search.open.filter((id) => typeof id === 'string') : []),
    [search.open],
  )
  const setOpen = useCallback(
    (next: string[]) => {
      void navigate({
        to: '.',
        replace: true,
        search: (previous: Record<string, unknown>) => ({
          ...previous,
          open: next.length === 0 ? undefined : next,
        }),
      })
    },
    [navigate],
  )
  return [open, setOpen]
}

/**
 * The Session Group view: the Sessions in the filter bar's window, one row per group with its
 * totals, the group's Sessions as a tree below it.
 */
export function SessionGroupsPage() {
  const { client } = useHub()
  const { filters, setFilters, tz } = useBoardFilters(defaultFilters)
  const [now] = useState(() => new Date())
  const window = useResolvedWindow(filters.time, now, tz)
  const inventory = useInventory(client, window)
  const ctx = useQueryContext(filters, undefined, allFilters, now, tz)
  const sessions = useSessionGroups(client, { from: ctx.from, to: ctx.to, sessions: ctx.sessions })
  const [open, setOpen] = useOpenRows()
  const groups = useMemo(() => groupSessions(sessions.data ?? []), [sessions.data])

  return (
    <Container width="full">
      <Stack gap={4}>
        <PageHeader
          title="Session Groups"
          description="Sessions grouped by Session Group, with each group's cost and tokens."
        />
        <FilterBar
          filters={filters}
          onChange={setFilters}
          inventory={inventory.data}
          loading={inventory.isPending}
          tz={tz}
          now={now}
        />
        {sessions.isPending ? (
          <Skeleton aria-label="Loading the Sessions" height="block" />
        ) : sessions.isError ? (
          <Alert
            tone="critical"
            title="The Sessions could not be loaded"
            action={
              <Button size="sm" variant="outline" onClick={() => void sessions.refetch()}>
                Try again
              </Button>
            }
          >
            {sessions.error instanceof Error ? sessions.error.message : 'The Hub did not answer.'}
          </Alert>
        ) : groups.length === 0 ? (
          <EmptyState
            title="No Sessions in this window"
            description="Widen the time range, or clear a filter."
          />
        ) : (
          <>
            <Text tone="muted">
              A group&apos;s cost and tokens are the sums of its Sessions&apos;, each counted whole
              if it touches the window. Click a group to see its Sessions.
            </Text>
            <SessionGroupTree groups={groups} tz={tz} expanded={open} onExpandedChange={setOpen} />
          </>
        )}
      </Stack>
    </Container>
  )
}
