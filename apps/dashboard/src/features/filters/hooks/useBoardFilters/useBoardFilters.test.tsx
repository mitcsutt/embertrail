import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { act, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { BoardFilters } from '#features/filters/types/filters'

import { useBoardFilters } from './useBoardFilters'
import type { UseBoardFilters } from './useBoardFilters'

const saved: BoardFilters = {
  time: { kind: 'relative', range: 'last-7-days' },
  model: 'claude-opus',
}

/** Renders the hook on a Board route at `url`; `latest()` is what the hook returned last. */
async function renderAt(url: string) {
  let current: UseBoardFilters | undefined
  function Probe() {
    current = useBoardFilters(saved)
    return <output>{JSON.stringify(current.filters)}</output>
  }
  const root = createRootRoute({ component: Outlet })
  const board = createRoute({
    getParentRoute: () => root,
    path: '/boards/$boardId',
    component: Probe,
  })
  const router = createRouter({
    routeTree: root.addChildren([board]),
    history: createMemoryHistory({ initialEntries: [url] }),
  })
  render(<RouterProvider router={router} />)
  await screen.findByRole('status')
  return {
    router,
    latest: () => {
      if (current === undefined) throw new Error('The hook has not rendered')
      return current
    },
  }
}

describe('useBoardFilters', () => {
  it('shows the saved filters for a URL with no search', async () => {
    const { latest } = await renderAt('/boards/overview')

    expect(latest().filters).toEqual(saved)
    expect(latest().changed).toBe(false)
  })

  it('reads the filters from the URL over the saved ones', async () => {
    const { latest } = await renderAt('/boards/overview?range="today"&source="src-1"')

    expect(latest().filters).toEqual({
      time: { kind: 'relative', range: 'today' },
      sourceId: 'src-1',
      model: 'claude-opus',
    })
    expect(latest().changed).toBe(true)
  })

  it('ignores a search it cannot read', async () => {
    const { latest } = await renderAt('/boards/overview?range="next-year"&from="nope"')

    expect(latest().filters).toEqual(saved)
  })

  it('writes a change to the URL, keeps other params, and replaces the entry', async () => {
    const { router, latest } = await renderAt('/boards/overview?edit=true')

    act(() => {
      latest().setFilters({ time: { kind: 'relative', range: 'yesterday' }, sourceId: 'src-2' })
    })

    await waitFor(() => {
      expect(latest().filters.sourceId).toBe('src-2')
    })
    expect(latest().filters.time).toEqual({ kind: 'relative', range: 'yesterday' })
    expect(router.state.location.search).toMatchObject({
      edit: true,
      range: 'yesterday',
      source: 'src-2',
    })
    expect(router.history.length).toBe(1)
  })

  it('clears a filter the Board saved with an explicit "all"', async () => {
    const { latest } = await renderAt('/boards/overview')

    act(() => {
      latest().setFilters({ model: undefined })
    })

    await waitFor(() => {
      expect(latest().filters.model).toBeUndefined()
    })
  })

  it('resets to the saved filters and keeps other params', async () => {
    const { router, latest } = await renderAt('/boards/overview?edit=true&range="today"&model=""')

    act(() => {
      latest().reset()
    })

    await waitFor(() => {
      expect(latest().filters).toEqual(saved)
    })
    expect(router.state.location.search).toEqual({ edit: true })
  })

  it('reads the zone from the browser, never a fixed offset', async () => {
    const { latest } = await renderAt('/boards/overview')

    expect(latest().tz).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
    expect(latest().tz).not.toMatch(/^[+-]\d/)
  })
})
