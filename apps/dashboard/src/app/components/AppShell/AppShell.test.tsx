import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Providers } from '#app/components/Providers'
import { routeTree } from '#routeTree'

function renderAt(path: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  return render(
    <Providers>
      <RouterProvider router={router} />
    </Providers>,
  )
}

describe('AppShell', () => {
  it('redirects / to the Overview Board and shows the navigation', async () => {
    renderAt('/')

    expect(await screen.findByRole('heading', { name: 'Board: overview' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Boards' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Session Groups' })).toBeInTheDocument()
  })

  it('renders the Session Groups page', async () => {
    renderAt('/sessions')

    expect(await screen.findByRole('heading', { name: 'Session Groups' })).toBeInTheDocument()
  })
})
