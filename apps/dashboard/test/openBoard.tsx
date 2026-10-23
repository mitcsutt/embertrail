// Renders the app's routes at a path against a client, for component tests of the Board pages.

import type { EmbertrailClient } from '@mitcsutt/embertrail-client'
import { ThemeProvider } from '@mitcsutt/kiln-ui'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router'
import { render } from '@testing-library/react'

import { HubProvider } from '#app/components/HubProvider'
import { createHub } from '#lib/hub'
import { routeTree } from '#routeTree'

export function openBoard(path: string, client: EmbertrailClient) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000 } } })
  render(
    <ThemeProvider theme="paper" defaultMode="light">
      <QueryClientProvider client={queryClient}>
        <HubProvider hub={{ ...createHub({ hubUrl: 'http://hub.test' }), client }}>
          <RouterProvider router={router} />
        </HubProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  )
  return { router }
}
