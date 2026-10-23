import type { EmbertrailClient } from '@mitcsutt/embertrail-client'
import { ProblemError } from '@mitcsutt/embertrail-client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { QueryContext } from '#features/filters/types/filters'
import { formatUsd as formatUsdRaw } from '#features/widgets/utils/formats'
import { WidgetClientProvider } from '#features/widgets/components/WidgetClientProvider'
import { catalogue, getWidget } from '#features/widgets/constants/catalogue'

import { Widget } from './Widget'

/** Dollars as the page's text reads them: Testing Library folds non-breaking spaces. */
const formatUsd = (value: number) => formatUsdRaw(value).replaceAll(/\s+/g, ' ')

const ctx: QueryContext = {
  from: '2026-11-04T00:00:00+01:00',
  to: '2026-11-05T00:00:00+01:00',
  tz: 'Europe/Berlin',
  filter: [],
  now: new Date('2026-11-04T13:00:00Z'),
  sessions: {},
}

type Call = (input: { body?: unknown; query?: unknown }) => Promise<unknown>

/** A client whose three query operations are the given stubs; the rest is never called. */
function clientWith(stubs: Partial<Record<'queryMetrics' | 'listSessions', unknown>>) {
  return stubs as unknown as EmbertrailClient
}

async function renderWidget(id: string, client: EmbertrailClient) {
  const definition = getWidget(id) ?? failed(id)
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000 } } })
  const root = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <WidgetClientProvider client={client}>
          <Widget definition={definition} ctx={ctx} />
        </WidgetClientProvider>
      </QueryClientProvider>
    ),
  })
  const session = createRoute({
    getParentRoute: () => root,
    path: '/sessions/$sessionId',
  })
  const router = createRouter({
    routeTree: root.addChildren([session]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  return render(<RouterProvider router={router} />)
}

describe('Widget', () => {
  it('has every Catalogue id once', () => {
    const ids = catalogue.map((widget) => widget.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('shows loading, then the Widget with the request it sent', async () => {
    const queryMetrics = vi
      .fn<Call>()
      .mockResolvedValue({ rows: [{ group: {}, value: 12.5 }], meta: {} })
    await renderWidget('cost-today', clientWith({ queryMetrics }))

    expect(screen.getByText(/loading/i)).toBeInTheDocument()
    expect(await screen.findByText(formatUsd(12.5))).toBeInTheDocument()
    expect(queryMetrics).toHaveBeenCalledOnce()
    expect(queryMetrics.mock.calls[0]?.[0].body).toMatchObject({
      metric: 'claude_code.cost.usage',
      aggregation: 'sum',
      from: ctx.from,
      to: ctx.to,
      tz: ctx.tz,
    })
  })

  it('shows the empty state when the Hub has no rows', async () => {
    const queryMetrics = vi.fn().mockResolvedValue({ rows: [], meta: {} })
    await renderWidget('cost-today', clientWith({ queryMetrics }))

    expect(await screen.findByText('Nothing to show for this period')).toBeInTheDocument()
  })

  it("shows the problem's detail on error and asks the Hub again on Retry", async () => {
    const queryMetrics = vi
      .fn()
      .mockRejectedValueOnce(
        new ProblemError({
          type: 'urn:embertrail:problem:too-many-rows',
          title: 'Too many rows',
          status: 422,
          detail: 'Set a limit.',
          request_id: 'r1',
        }),
      )
      .mockResolvedValue({ rows: [{ group: {}, value: 3 }], meta: {} })
    await renderWidget('cost-today', clientWith({ queryMetrics }))

    expect(await screen.findByText('Set a limit.')).toBeInTheDocument()
    expect(queryMetrics).toHaveBeenCalledOnce()

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText(formatUsd(3.0))).toBeInTheDocument()
    expect(queryMetrics).toHaveBeenCalledTimes(2)
  })

  it('draws Each day by model as a chart with its data table', async () => {
    const queryMetrics = vi.fn().mockResolvedValue({
      rows: [
        { bucket: '2026-11-03T00:00:00+01:00', group: { model: 'claude-opus-4-7' }, value: 4 },
        { bucket: '2026-11-03T00:00:00+01:00', group: { model: 'claude-haiku-4-5' }, value: 1 },
        { bucket: '2026-11-04T00:00:00+01:00', group: { model: 'claude-opus-4-7' }, value: 2 },
      ],
      meta: {},
    })
    await renderWidget('each-day-by-model', clientWith({ queryMetrics }))

    // The chart's data table, which kiln-charts keeps for screen readers: a column per model and
    // a row per local day.
    const table = within(await screen.findByRole('table'))
    expect(table.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Day',
      'claude-opus-4-7',
      'claude-haiku-4-5',
    ])
    expect(table.getByRole('row', { name: /3 Nov/ })).toHaveTextContent(
      `${formatUsd(4)}${formatUsd(1)}`.replaceAll(' ', ' '),
    )
  })

  it('lists Top sessions with a link to each Session', async () => {
    const listSessions = vi.fn<Call>().mockResolvedValue({
      items: [
        {
          id: '0a1b2c3d-aaaa-bbbb-cccc-111122223333',
          started_at: '2026-11-04T08:00:00Z',
          models: ['claude-opus-4-7', 'claude-haiku-4-5'],
          cost_usd: 8.25,
        },
        { id: 'no-cost', started_at: null, models: [], cost_usd: null },
      ],
      next_cursor: null,
    })
    await renderWidget('top-sessions', clientWith({ listSessions }))

    const link = await screen.findByRole('link', { name: '0a1b2c3d' })
    expect(link).toHaveAttribute('href', '/sessions/0a1b2c3d-aaaa-bbbb-cccc-111122223333')
    expect(screen.getByText(formatUsd(8.25))).toBeInTheDocument()
    expect(screen.getByText('claude-opus-4-7, claude-haiku-4-5')).toBeInTheDocument()
    expect(screen.queryByText('no-cost')).not.toBeInTheDocument()
    expect(listSessions.mock.calls[0]?.[0].query).toMatchObject({
      sort: '-cost_usd',
      limit: 10,
      from: ctx.from,
      to: ctx.to,
    })
  })
})

function failed(id: string): never {
  throw new Error(`${id} is not in the Catalogue`)
}
