// The Session Group view and a Session's page in jsdom, against an in-memory Hub (`fakeHub`):
// the tree opens and closes by keyboard three levels deep, each Session links to its page, and
// the Event timeline loads more through the cursor.

import type { EmbertrailClient, Schemas } from '@mitcsutt/embertrail-client'
import { ThemeProvider } from '@mitcsutt/kiln-ui'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { HubProvider } from '#app/components/HubProvider'
import { createHub } from '#lib/hub'
import { routeTree } from '#routeTree'

import { fakeHub } from './fakeHub.ts'

function open(path: string, client: EmbertrailClient) {
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

function session(
  id: string,
  over: Partial<Schemas['SessionSummary']> = {},
): Schemas['SessionSummary'] {
  return {
    id,
    service_name: 'claude-code',
    owner_id: 'u1',
    source_id: 's1',
    account_id: null,
    started_at: '2026-11-03T10:00:00Z',
    last_seen_at: '2026-11-03T11:00:00Z',
    models: ['claude-opus-4-7'],
    cost_usd: 1,
    tokens: { input: 1000, output: 500 },
    event_counts: { api_request: 2 },
    group: null,
    parent_session_id: null,
    role: null,
    labels: {},
    ...over,
  }
}

const group = { id: 'billing', kind: 'batch' }
const sessions = [
  session('aaaaaaaa-root', { group, cost_usd: 2, role: 'orchestrator' }),
  session('bbbbbbbb-child', { group, parent_session_id: 'aaaaaaaa-root', cost_usd: 1.5 }),
  session('cccccccc-grand', { group, parent_session_id: 'bbbbbbbb-child', cost_usd: 0.5 }),
  session('dddddddd-loose', { cost_usd: 4 }),
]

const events = (count: number): Schemas['Event'][] =>
  Array.from({ length: count }, (_, index) => ({
    time: `2026-11-03T10:00:${String(index).padStart(2, '0')}Z`,
    event_name: index % 2 === 0 ? 'api_request' : 'tool_result',
    sequence: index,
    session_id: 'aaaaaaaa-root',
    prompt_id: null,
    request_id: null,
    model: 'claude-opus-4-7',
    service_name: 'claude-code',
    owner_id: 'u1',
    source_id: 's1',
    account_id: null,
    body: null,
    attributes: index % 2 === 0 ? { duration_ms: 1200 } : { tool_name: 'Bash', success: false },
    resource: {},
  }))

describe('SessionGroupsPage', () => {
  it('lists the groups with their totals, and the Sessions without a group last', async () => {
    open('/sessions', fakeHub({ sessions }).client)

    const tree = await screen.findByRole('treegrid', { name: 'Session Groups' })
    const rows = within(tree).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('billing')
    expect(rows[0]).toHaveTextContent('batch')
    expect(rows[0]).toHaveTextContent('3') // Sessions
    expect(rows[0]).toHaveTextContent('4.00') // 2 + 1.5 + 0.5
    expect(rows[0]).toHaveTextContent('4.5K') // three Sessions of 1,500 tokens
    expect(rows[1]).toHaveTextContent('No group')
    expect(rows[1]).toHaveTextContent('4.00')
  })

  it('opens three levels by keyboard and links each Session to its page', async () => {
    const user = userEvent.setup()
    open('/sessions', fakeHub({ sessions }).client)
    const tree = await screen.findByRole('treegrid', { name: 'Session Groups' })

    const first = within(tree).getByRole('row', { name: /billing/ })
    expect(first).toHaveAttribute('aria-expanded', 'false')
    // The grid is one tab stop; the arrow keys then move and open rows.
    first.focus()
    await user.keyboard('{ArrowRight}') // open the group
    await user.keyboard('{ArrowRight}') // into the root
    await user.keyboard('{ArrowRight}') // open the root
    await user.keyboard('{ArrowRight}') // into the child
    await user.keyboard('{ArrowRight}') // open the child

    const levels = within(tree)
      .getAllByRole('row')
      .map((row) => row.getAttribute('aria-level'))
    expect(levels.filter((level) => level !== null).slice(0, 4)).toEqual(['1', '2', '3', '4'])
    expect(within(tree).getByRole('link', { name: 'cccccccc' })).toHaveAttribute(
      'href',
      '/sessions/cccccccc-grand',
    )
    expect(within(tree).getByRole('link', { name: 'aaaaaaaa' })).toBeVisible()
    expect(within(tree).getByText('orchestrator')).toBeVisible()

    await user.keyboard('{ArrowLeft}{ArrowLeft}') // close the child, then step out to the root
    expect(within(tree).queryByRole('link', { name: 'cccccccc' })).not.toBeInTheDocument()
  })

  it('opens and closes a group from anywhere on its row, and by Enter', async () => {
    const user = userEvent.setup()
    open('/sessions', fakeHub({ sessions }).client)
    const tree = await screen.findByRole('treegrid', { name: 'Session Groups' })
    const row = within(tree).getByRole('row', { name: /billing/ })

    await user.click(within(row).getAllByRole('cell')[3] as HTMLElement) // the Sessions count
    expect(row).toHaveAttribute('aria-expanded', 'true')
    expect(within(tree).getByRole('link', { name: 'aaaaaaaa' })).toBeVisible()

    await user.click(within(row).getByText('batch'))
    expect(row).toHaveAttribute('aria-expanded', 'false')

    row.focus()
    await user.keyboard('{Enter}')
    expect(row).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard(' ')
    expect(row).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens a Session from anywhere on its row', async () => {
    const user = userEvent.setup()
    const { router } = open('/sessions', fakeHub({ sessions, events: events(1) }).client)
    const tree = await screen.findByRole('treegrid', { name: 'Session Groups' })
    await user.click(within(tree).getByRole('row', { name: /No group/ }))
    await user.click(within(tree).getByRole('row', { name: /dddddddd/ }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Session dddddddd' })).toBeVisible()
    expect(router.state.location.pathname).toBe('/sessions/dddddddd-loose')
  })

  it('keeps the open rows in the URL', async () => {
    const user = userEvent.setup()
    const { router } = open('/sessions?range=last-7-days', fakeHub({ sessions }).client)
    const tree = await screen.findByRole('treegrid', { name: 'Session Groups' })
    await user.click(within(tree).getByRole('row', { name: /billing/ }))

    expect(router.state.location.search).toMatchObject({
      range: 'last-7-days',
      open: ['group/billing'],
    })
  })

  it('shows the open rows a URL names', async () => {
    open('/sessions?open=%5B%22group%2Fbilling%22%5D', fakeHub({ sessions }).client)
    const tree = await screen.findByRole('treegrid', { name: 'Session Groups' })

    expect(within(tree).getByRole('row', { name: /billing/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('says so when the window holds no Sessions', async () => {
    open('/sessions', fakeHub().client)

    expect(await screen.findByText('No Sessions in this window')).toBeVisible()
  })

  it('asks the Hub for the window and the filters of the bar', async () => {
    const hub = fakeHub({ sessions })
    open('/sessions?range=last-7-days&model=claude-opus-4-7', hub.client)
    await screen.findByRole('treegrid', { name: 'Session Groups' })

    const listed = hub.requests.filter(({ path }) => path === '/api/v1/sessions')
    expect(listed).toHaveLength(1)
    expect(listed[0]?.line).toContain('model=claude-opus-4-7')
    expect(listed[0]?.line).toContain('limit=1000')
  })
})

describe('SessionPage', () => {
  it('shows the Session, its place in the group and its children', async () => {
    open('/sessions/bbbbbbbb-child', fakeHub({ sessions, events: events(2) }).client)

    expect(await screen.findByRole('heading', { level: 1, name: 'Session bbbbbbbb' })).toBeVisible()
    expect(screen.getByText('billing')).toBeVisible()
    expect(screen.getByRole('link', { name: 'aaaaaaaa' })).toHaveAttribute(
      'href',
      '/sessions/aaaaaaaa-root',
    )
    expect(screen.getByRole('link', { name: 'cccccccc' })).toHaveAttribute(
      'href',
      '/sessions/cccccccc-grand',
    )
    expect(screen.getByText(/1\.50/)).toBeVisible()
  })

  it('draws the Events and loads more through the cursor', async () => {
    const user = userEvent.setup()
    const hub = fakeHub({ sessions, events: events(5), eventPageSize: 2 })
    open('/sessions/aaaaaaaa-root', hub.client)

    const table = await screen.findByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(3) // the header and a page of 2
    expect(within(table).getAllByText('Bash · failed')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Load more' }))
    await user.click(await screen.findByRole('button', { name: 'Load more' }))

    expect(within(table).getAllByRole('row')).toHaveLength(6)
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
    const asked = hub.requests.filter(({ path }) => path === '/api/v1/events/query')
    expect(asked.map(({ body }) => (body as { cursor?: string }).cursor)).toEqual([
      undefined,
      '2',
      '4',
    ])
    expect(asked[0]?.body).toMatchObject({
      mode: 'list',
      order: 'asc',
      filter: [{ key: 'session.id', op: 'eq', value: 'aaaaaaaa-root' }],
    })
  })

  it('goes back to the Session Groups as they were, filters and open rows kept', async () => {
    const user = userEvent.setup()
    const { router } = open(
      '/sessions?range=last-7-days&model=claude-opus-4-7',
      fakeHub({ sessions, events: events(1) }).client,
    )
    const tree = await screen.findByRole('treegrid', { name: 'Session Groups' })
    await user.click(within(tree).getByRole('row', { name: /billing/ }))
    await user.click(within(tree).getByRole('link', { name: 'aaaaaaaa' }))
    await screen.findByRole('heading', { level: 1, name: 'Session aaaaaaaa' })

    await user.click(screen.getByRole('button', { name: 'Back' }))

    const back = await screen.findByRole('treegrid', { name: 'Session Groups' })
    expect(router.state.location.pathname).toBe('/sessions')
    expect(router.state.location.search).toMatchObject({
      range: 'last-7-days',
      model: 'claude-opus-4-7',
      open: ['group/billing'],
    })
    expect(within(back).getByRole('row', { name: /billing/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('links to the Session Groups when it was opened directly', async () => {
    open('/sessions/aaaaaaaa-root', fakeHub({ sessions, events: events(1) }).client)
    await screen.findByRole('heading', { level: 1, name: 'Session aaaaaaaa' })

    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'All Session Groups' })).toHaveAttribute(
      'href',
      '/sessions',
    )
  })

  it('says so when the Hub does not know the Session', async () => {
    open('/sessions/nope', fakeHub({ sessions }).client)

    expect(await screen.findByText('No such Session')).toBeVisible()
  })

  it('has no Events to ask for when the Session is known only from its Labels', async () => {
    const hub = fakeHub({
      sessions: [session('labelled', { started_at: null, last_seen_at: null, cost_usd: null })],
    })
    open('/sessions/labelled', hub.client)

    expect(
      await screen.findByText('The Hub knows this Session only from its Labels.'),
    ).toBeVisible()
    expect(hub.requests.some(({ path }) => path === '/api/v1/events/query')).toBe(false)
  })
})
