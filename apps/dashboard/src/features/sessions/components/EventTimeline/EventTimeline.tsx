import { Alert, Button, EmptyState, Skeleton, Stack, Table } from '@mitcsutt/kiln-ui'

import { useLocale } from '#features/locale/hooks/useLocale'
import { useMoney } from '#features/locale/hooks/useMoney'
import type { HubEvent } from '#features/sessions/data/session'
import { describeEvent } from '#features/sessions/utils/describeEvent'
import { formatTime } from '#features/sessions/utils/formats'

export interface EventTimelineProps {
  events: readonly HubEvent[]
  status: 'pending' | 'error' | 'success'
  error?: unknown
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  onRetry: () => void
  tz: string
}

/** A Session's Events, oldest first, with "Load more" while the Hub has another page. */
export function EventTimeline({
  events,
  status,
  error,
  hasMore,
  loadingMore,
  onLoadMore,
  onRetry,
  tz,
}: EventTimelineProps) {
  const money = useMoney()
  const { locale } = useLocale()
  if (status === 'pending') return <Skeleton aria-label="Loading the Events" height="block" />
  if (status === 'error') {
    return (
      <Alert
        tone="critical"
        title="The Events could not be loaded"
        action={
          <Button size="sm" variant="outline" onClick={onRetry}>
            Try again
          </Button>
        }
      >
        {error instanceof Error ? error.message : 'The Hub did not answer.'}
      </Alert>
    )
  }
  if (events.length === 0) {
    return (
      <EmptyState
        title="No Events"
        description="This Session has sent Metrics but no Events, or only Labels."
      />
    )
  }
  return (
    <Stack gap={3}>
      <Table label="Event timeline" density="compact">
        <Table.Head>
          <Table.Row>
            <Table.HeaderCell>Time</Table.HeaderCell>
            <Table.HeaderCell>Event</Table.HeaderCell>
            <Table.HeaderCell>Model</Table.HeaderCell>
            <Table.HeaderCell>Details</Table.HeaderCell>
          </Table.Row>
        </Table.Head>
        <Table.Body>
          {events.map((event, index) => (
            <Table.Row key={`${event.time}/${String(event.sequence)}/${String(index)}`}>
              <Table.Cell>{formatTime(event.time, tz, { seconds: true }, locale)}</Table.Cell>
              <Table.Cell rowHeader>{event.event_name}</Table.Cell>
              <Table.Cell>{event.model ?? '–'}</Table.Cell>
              <Table.Cell>{describeEvent(event, (usd) => money.format(usd, 4))}</Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
      {hasMore ? (
        <div>
          <Button variant="outline" onClick={onLoadMore} loading={loadingMore}>
            Load more
          </Button>
        </div>
      ) : null}
    </Stack>
  )
}
