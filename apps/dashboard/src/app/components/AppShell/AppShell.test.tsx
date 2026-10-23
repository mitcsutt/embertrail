import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Providers } from '#app/components/Providers'
import { HubProvider } from '#app/components/HubProvider'
import { createHub } from '#lib/hub'
import { routeTree } from '#routeTree'

function renderAt(path: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  return render(
    <Providers>
      <HubProvider hub={createHub({ hubUrl: 'http://hub.test' })}>
        <RouterProvider router={router} />
      </HubProvider>
    </Providers>,
  )
}

const self = {
  user: { id: 'u1', name: 'Dana', email: null, admin: false },
  scopes: ['otel:read', 'store:read', 'store:write'],
  teams: [],
}

describe('AppShell', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: Request | string | URL) => {
        const url = input instanceof Request ? input.url : String(input)
        return Promise.resolve(
          url.endsWith('/api/v1/self')
            ? new Response(JSON.stringify(self), {
                headers: { 'content-type': 'application/json' },
              })
            : new Response('', { status: 404 }),
        )
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('redirects / to the Overview Board and shows the navigation', async () => {
    renderAt('/')

    expect(await screen.findByRole('heading', { name: 'Overview', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Boards' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Session Groups' })).toBeInTheDocument()
  })

  it('renders the Session Groups page', async () => {
    renderAt('/sessions')

    expect(await screen.findByRole('heading', { name: 'Session Groups' })).toBeInTheDocument()
  })

  it('says who is signed in', async () => {
    renderAt('/sessions')

    expect(await screen.findByText('Signed in as Dana')).toBeInTheDocument()
  })

  it('still renders when the Hub does not know getSelf', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('', { status: 404 }))),
    )
    renderAt('/sessions')

    expect(await screen.findByRole('heading', { name: 'Session Groups' })).toBeInTheDocument()
    expect(screen.queryByText(/Signed in as/)).not.toBeInTheDocument()
  })
})
