import { isProblemError } from '@mitcsutt/embertrail-client'
import { Alert, Button, Container, EmptyState, Skeleton, Stack } from '@mitcsutt/kiln-ui'
import { Link, useParams } from '@tanstack/react-router'
import { useMemo } from 'react'

import { SectionTitle } from '#components/SectionTitle'
import { useBrowserTimeZone } from '#features/filters/hooks/useBrowserTimeZone'
import { BackControl } from '#features/sessions/components/BackControl'
import { EventTimeline } from '#features/sessions/components/EventTimeline'
import { SessionHeader } from '#features/sessions/components/SessionHeader'
import { sessionSpan, useSession, useSessionEvents } from '#features/sessions/data/session'
import { useHub } from '#lib/hub'

/** One Session: its header, and its Events oldest first. */
export function SessionPage() {
  const { sessionId } = useParams({ from: '/sessions/$sessionId' })
  const { client } = useHub()
  const tz = useBrowserTimeZone()
  const session = useSession(client, sessionId)
  const span = useMemo(
    () => (session.data === undefined ? undefined : sessionSpan(session.data)),
    [session.data],
  )
  const events = useSessionEvents(client, sessionId, span, tz)
  const items = useMemo(() => events.data?.pages.flatMap((page) => page.items) ?? [], [events.data])

  if (session.isPending) {
    return (
      <Container width="full">
        <Skeleton aria-label="Loading the Session" height="block" />
      </Container>
    )
  }
  if (session.isError) {
    const missing = isProblemError(session.error) && session.error.status === 404
    return (
      <Container width="narrow">
        {missing ? (
          <EmptyState
            title="No such Session"
            description="The Hub holds no Signals or Labels for it."
            action={
              <Button asChild variant="outline">
                <Link to="/sessions">Back to Session Groups</Link>
              </Button>
            }
          />
        ) : (
          <Alert
            tone="critical"
            title="This Session cannot be shown"
            action={
              <Button size="sm" variant="outline" onClick={() => void session.refetch()}>
                Try again
              </Button>
            }
          >
            {session.error instanceof Error ? session.error.message : 'The Hub did not answer.'}
          </Alert>
        )}
      </Container>
    )
  }

  return (
    <Container width="full">
      <Stack gap={4}>
        <div>
          <BackControl />
        </div>
        <SessionHeader session={session.data} tz={tz} />
        <Stack gap={3}>
          <SectionTitle title="Events" />
          {span === undefined ? (
            <EmptyState
              title="No Events"
              description="The Hub knows this Session only from its Labels."
            />
          ) : (
            <EventTimeline
              events={items}
              status={events.status}
              error={events.error}
              hasMore={events.hasNextPage}
              loadingMore={events.isFetchingNextPage}
              onLoadMore={() => void events.fetchNextPage()}
              onRetry={() => void events.refetch()}
              tz={tz}
            />
          )}
        </Stack>
      </Stack>
    </Container>
  )
}
