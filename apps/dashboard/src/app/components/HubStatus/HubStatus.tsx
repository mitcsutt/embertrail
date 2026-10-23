import { Alert, Button, Container, Skeleton, Stack } from '@mitcsutt/kiln-ui'
import { useQuery } from '@tanstack/react-query'
import { useMemo, type ReactNode } from 'react'

import { describeHubProblem } from '#app/utils/hubProblem'
import { loadRuntimeConfig } from '#config/runtimeConfig'
import { HubProvider } from '#app/components/HubProvider'
import { createHub, useHub } from '#lib/hub'

function Problem({
  title,
  children,
  retry,
}: {
  title: string
  children: string
  retry: () => void
}) {
  return (
    <Container width="narrow">
      <Stack gap={4}>
        <Alert
          tone="critical"
          title={title}
          action={
            <Button size="sm" variant="outline" onClick={retry}>
              Try again
            </Button>
          }
        >
          {children}
        </Alert>
      </Stack>
    </Container>
  )
}

/** Asks the Hub for its Inventory once; a failure is the app's one "can't use the Hub" state. */
function Probe({ children }: { children: ReactNode }) {
  const { client, hubUrl, display } = useHub()
  const { status, error, refetch } = useQuery({
    queryKey: ['hub', hubUrl, 'probe'],
    queryFn: ({ signal }) => client.getInventory({ signal }),
    retry: false,
    staleTime: Infinity,
  })
  if (status === 'pending') return <Skeleton aria-label="Connecting to the Hub" height="block" />
  if (status === 'error') {
    const problem = describeHubProblem(error, display, hubUrl === '')
    return (
      <Problem title={problem.title} retry={() => void refetch()}>
        {problem.body}
      </Problem>
    )
  }
  return children
}

/**
 * Loads `config.json`, builds the Hub client from it and checks the Hub answers before the app
 * renders. A bad file, an unreachable Hub, a 401 and a 403 each get a message naming the address.
 */
export function HubStatus({ children }: { children: ReactNode }) {
  const config = useQuery({
    queryKey: ['config'],
    queryFn: () => loadRuntimeConfig(),
    retry: false,
    staleTime: Infinity,
  })
  const hub = useMemo(
    () => (config.data === undefined ? undefined : createHub(config.data)),
    [config.data],
  )

  if (config.status === 'pending') return <Skeleton aria-label="Loading" height="block" />
  if (hub === undefined) {
    return (
      <Problem
        title="The Dashboard's config.json can't be used"
        retry={() => void config.refetch()}
      >
        {config.error instanceof Error ? config.error.message : 'Unknown error.'}
      </Problem>
    )
  }
  return (
    <HubProvider hub={hub}>
      <Probe>{children}</Probe>
    </HubProvider>
  )
}
