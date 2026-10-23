// The Board view against an in-memory Hub (`fakeHub`): Presets and stored Boards draw every item,
// a filter change asks the Hub only for the Widgets it affects, and the navigation reaches every
// Board.

import type { EmbertrailClient } from '@mitcsutt/embertrail-client'
import { ThemeProvider } from '@mitcsutt/kiln-ui'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { HubProvider } from '#app/components/HubProvider'
import type { BoardDocument } from '#features/boards/types/board'
import { overviewPreset, presetBoard } from '#features/boards/utils/presets'
import type { PresetId } from '#features/boards/utils/presets'
import { catalogue, getWidget } from '#features/widgets/constants/catalogue'
import { createHub } from '#lib/hub'
import { routeTree } from '#routeTree'

import { fakeHub } from './fakeHub.ts'

function openBoard(path: string, client: EmbertrailClient) {
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

const storedBoard: BoardDocument = {
  schema_version: 1,
  name: 'My spend',
  filters: { time: { kind: 'relative', range: 'last-7-days' } },
  items: [
    { i: 'head', type: 'section', title: 'Money' },
    { i: 'a', type: 'widget', widget: 'cost-today' },
    { i: 'b', type: 'widget', widget: 'no-such-widget' },
    {
      i: 'c',
      type: 'query',
      title: 'My query',
      query: {
        source: { kind: 'metric', name: 'claude_code.cost.usage', aggregation: 'sum' },
        groupBy: [],
        filter: [],
        chart: 'stat',
      },
    },
  ],
  layout: [
    { i: 'head', x: 0, y: 0, w: 12, h: 1, static: true },
    { i: 'a', x: 0, y: 1, w: 3, h: 2 },
    { i: 'b', x: 3, y: 1, w: 3, h: 2 },
    { i: 'c', x: 6, y: 1, w: 3, h: 2 },
  ],
}

describe('BoardPage', () => {
  it.each<PresetId>(['overview', 'everything'])(
    '/boards/%s draws every item of the Preset',
    async (id) => {
      openBoard(`/boards/${id}`, fakeHub().client)
      const board = presetBoard(id, catalogue)

      expect(await screen.findByRole('heading', { level: 1, name: board.name })).toBeVisible()
      const grid = within(await screen.findByRole('group', { name: board.name }))
      const widgets = board.items.flatMap((item) =>
        item.type === 'widget' ? [getWidget(item.widget)] : [],
      )
      for (const section of board.items.filter((item) => item.type === 'section')) {
        expect(grid.getByRole('heading', { level: 2, name: section.title })).toBeVisible()
      }
      for (const definition of widgets.filter((widget) => widget !== undefined)) {
        expect(grid.getByRole('group', { name: definition.title })).toBeVisible()
      }
      const unknown = widgets.filter((widget) => widget === undefined).length
      // A Widget the Catalogue does not hold yet is a frame of its own, never a crash.
      expect(grid.queryAllByRole('group', { name: 'Unknown Widget' })).toHaveLength(unknown)
    },
  )

  it('lists every Widget of the Catalogue once on the Everything Board', () => {
    const ids = presetBoard('everything', catalogue).items.flatMap((item) =>
      item.type === 'widget' ? [item.widget] : [],
    )
    expect(ids.toSorted()).toEqual(catalogue.map((widget) => widget.id).toSorted())
  })

  it('names the Overview Widgets the Catalogue lacks as Unknown Widgets', async () => {
    openBoard('/boards/overview', fakeHub().client)
    const missing = overviewPreset.items.filter(
      (item) => item.type === 'widget' && getWidget(item.widget) === undefined,
    )

    expect(await screen.findAllByRole('group', { name: 'Unknown Widget' })).toHaveLength(
      missing.length,
    )
  })

  it('asks the Hub once for each Widget a filter change affects, and for no other', async () => {
    const hub = fakeHub()
    const { router } = openBoard('/boards/everything', hub.client)
    await waitFor(() => {
      expect(hub.widgetRequests()).toHaveLength(catalogue.length)
    })
    const before = hub.widgetRequests().length

    await router.navigate({ to: '.', search: { range: 'last-30-days' } })

    // Only the Widgets that follow the Board's range ask again; a fixed window does not.
    const following = catalogue.filter((widget) => widget.window === 'board')
    expect(following.length).toBeGreaterThan(0)
    expect(following.length).toBeLessThan(catalogue.length)
    await waitFor(() => {
      expect(hub.widgetRequests().length - before).toBe(following.length)
    })
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(hub.widgetRequests().length - before).toBe(following.length)
  })

  it('draws a stored Board with its sections, unknown Widgets and Query Widgets', async () => {
    openBoard('/boards/b-spend00001', fakeHub({ boards: { 'b-spend00001': storedBoard } }).client)

    expect(await screen.findByRole('heading', { level: 1, name: 'My spend' })).toBeVisible()
    const grid = within(await screen.findByRole('group', { name: 'My spend' }))
    expect(grid.getByRole('heading', { level: 2, name: 'Money' })).toBeVisible()
    expect(grid.getByRole('group', { name: 'Cost today' })).toBeVisible()
    expect(grid.getByRole('group', { name: 'Unknown Widget' })).toBeVisible()
    expect(grid.getByRole('group', { name: 'My query' })).toBeVisible()
  })

  it('says so when the Board does not exist', async () => {
    openBoard('/boards/b-nosuchboard', fakeHub().client)

    expect(await screen.findByText('No such Board')).toBeVisible()
  })

  it('says why a stored Board cannot be shown', async () => {
    const hub = fakeHub({ boards: { 'b-broken0001': { schema_version: 1, name: 5 } } })
    openBoard('/boards/b-broken0001', hub.client)

    expect(await screen.findByText('This Board cannot be shown')).toBeVisible()
  })

  it('offers Customise on a Preset', async () => {
    openBoard('/boards/overview', fakeHub().client)
    expect(await screen.findByRole('button', { name: 'Customise' })).toBeDisabled()
  })

  it('offers Edit on a stored Board', async () => {
    openBoard('/boards/b-spend00001', fakeHub({ boards: { 'b-spend00001': storedBoard } }).client)
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeDisabled()
  })

  it('offers no editing to a Token without store:write', async () => {
    openBoard('/boards/overview', fakeHub({ scopes: ['otel:read', 'store:read'] }).client)

    await screen.findByText(/Signed in as/)
    expect(screen.queryByRole('button', { name: 'Customise' })).not.toBeInTheDocument()
  })
})

describe('Board navigation', () => {
  it('lists the Presets and the stored Boards, and jumps with the palette', async () => {
    const hub = fakeHub({ boards: { 'b-spend00001': storedBoard } })
    const user = userEvent.setup()
    openBoard('/boards/overview', hub.client)

    const nav = within(await screen.findByRole('navigation', { name: 'Board list' }))
    expect(nav.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page')
    expect(nav.getByRole('link', { name: 'Everything' })).toBeVisible()
    expect(await nav.findByRole('link', { name: 'My spend' })).toHaveAttribute(
      'href',
      '/boards/b-spend00001',
    )
    expect(nav.getByRole('link', { name: 'New Board' })).toHaveAttribute('href', '/boards/new')

    await user.keyboard('{Control>}k{/Control}')
    await user.keyboard('My spe')
    await user.keyboard('{Enter}')

    expect(await screen.findByRole('heading', { level: 1, name: 'My spend' })).toBeVisible()
  })
})
