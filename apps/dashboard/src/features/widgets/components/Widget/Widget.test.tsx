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
import {
  formatPercent as formatPercentRaw,
  formatUsd as formatUsdRaw,
} from '#features/widgets/utils/formats'
import { catalogue, getWidget } from '#features/widgets/constants/catalogue'
import { HubContext } from '#lib/hub'

import { Widget } from './Widget'

/** Dollars as the page's text reads them: Testing Library folds non-breaking spaces. */
const formatUsd = (value: number) => formatUsdRaw(value).replaceAll(/\s+/g, ' ')
const formatPercent = (value: number) => formatPercentRaw(value).replaceAll(/\s+/g, ' ')

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
function clientWith(
  stubs: Partial<Record<'queryMetrics' | 'listSessions' | 'getInventory', unknown>>,
) {
  return stubs as unknown as EmbertrailClient
}

async function renderWidget(
  id: string,
  client: EmbertrailClient,
  context: Partial<QueryContext> = {},
) {
  const definition = getWidget(id) ?? failed(id)
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000 } } })
  const root = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <HubContext value={{ client, hubUrl: '', display: 'http://localhost' }}>
          <Widget definition={definition} ctx={{ ...ctx, ...context }} />
        </HubContext>
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
    expect(table.getByRole('row', { name: /3 Nov|Nov 3/ })).toHaveTextContent(
      `${formatUsd(4)}${formatUsd(1)}`,
    )
  })

  it('shows Cost this week as a stat for the week', async () => {
    const queryMetrics = vi
      .fn<Call>()
      .mockResolvedValue({ rows: [{ group: {}, value: 41.5 }], meta: {} })
    await renderWidget('cost-this-week', clientWith({ queryMetrics }))

    expect(await screen.findByText(formatUsd(41.5))).toBeInTheDocument()
    expect(screen.getByText('Cost this week')).toBeInTheDocument()
  })

  it('shows Sessions today as a count and forwards the resolved filter', async () => {
    const queryMetrics = vi
      .fn<Call>()
      .mockResolvedValue({ rows: [{ group: {}, value: 7 }], meta: {} })
    await renderWidget('sessions-today', clientWith({ queryMetrics }), {
      filter: [{ key: 'model', op: 'eq', value: 'claude-opus-4-7' }],
    })

    expect(await screen.findByText('7')).toBeInTheDocument()
    expect(queryMetrics.mock.calls[0]?.[0].body).toMatchObject({
      metric: 'claude_code.session.count',
      filter: [{ key: 'model', op: 'eq', value: 'claude-opus-4-7' }],
    })
  })

  it('shows Cache share as the cached part of all input', async () => {
    const queryMetrics = vi.fn<Call>().mockResolvedValue({
      rows: [
        { group: { type: 'input' }, value: 100 },
        { group: { type: 'output' }, value: 5000 },
        { group: { type: 'cacheRead' }, value: 800 },
        { group: { type: 'cacheCreation' }, value: 100 },
      ],
      meta: {},
    })
    await renderWidget('cache-share', clientWith({ queryMetrics }))

    // 800 of 1,000 input tokens; the 5,000 output tokens are not input.
    expect(await screen.findByText(formatPercent(0.8))).toBeInTheDocument()
  })

  it('shows Cache share as empty when no input was counted', async () => {
    const queryMetrics = vi.fn<Call>().mockResolvedValue({
      rows: [{ group: { type: 'output' }, value: 12 }],
      meta: {},
    })
    await renderWidget('cache-share', clientWith({ queryMetrics }))

    expect(await screen.findByText('Nothing to show for this period')).toBeInTheDocument()
  })

  it('names Cost by Account by the Inventory label, once it has answered', async () => {
    const queryMetrics = vi.fn<Call>().mockResolvedValue({
      rows: [
        { group: { 'embertrail.account_id': 'a-1' }, value: 3 },
        { group: { 'embertrail.account_id': 'a-2' }, value: 9 },
      ],
      meta: {},
    })
    const getInventory = vi.fn<Call>().mockResolvedValue({
      accounts: [
        { id: 'a-1', label: 'Personal', email: 'me@example.org' },
        { id: 'a-2', label: 'Work', email: 'me@example.com' },
      ],
    })
    await renderWidget('cost-by-account', clientWith({ queryMetrics, getInventory }))

    const table = within(await screen.findByRole('table'))
    // Most expensive first, each named by its label.
    const [, work, personal] = table.getAllByRole('row')
    expect(work).toHaveTextContent(`Work${formatUsd(9)}`)
    expect(personal).toHaveTextContent(`Personal${formatUsd(3)}`)
    expect(getInventory).toHaveBeenCalledOnce()
    expect(getInventory.mock.calls[0]?.[0].query).toEqual({ from: ctx.from, to: ctx.to })
  })

  it.each([
    [
      'a 4xx problem, without retrying',
      new ProblemError({
        type: 'urn:embertrail:problem:forbidden',
        title: 'Forbidden',
        status: 403,
        detail: 'No.',
        request_id: 'r2',
      }),
      1,
    ],
    ['a network error, after one retry', new TypeError('Failed to fetch'), 2],
  ])(
    'still draws Cost by Account with ids for names when the Inventory fails with %s',
    async (_name, failure, calls) => {
      const queryMetrics = vi.fn<Call>().mockResolvedValue({
        rows: [
          { group: { 'embertrail.account_id': 'a-1' }, value: 3 },
          { group: { 'embertrail.account_id': 'a-2' }, value: 9 },
        ],
        meta: {},
      })
      const getInventory = vi.fn<Call>().mockRejectedValue(failure)
      await renderWidget('cost-by-account', clientWith({ queryMetrics, getInventory }))

      // The default retry (3 attempts, backed off to about 7s) would outlast this timeout.
      const table = within(await screen.findByRole('table', {}, { timeout: 3000 }))
      const [, second, first] = table.getAllByRole('row')
      expect(second).toHaveTextContent(`a-2${formatUsd(9)}`)
      expect(first).toHaveTextContent(`a-1${formatUsd(3)}`)
      expect(getInventory).toHaveBeenCalledTimes(calls)
    },
  )

  it('draws Sessions per day stacked by start type', async () => {
    const queryMetrics = vi.fn<Call>().mockResolvedValue({
      rows: [
        { bucket: '2026-11-03T00:00:00+01:00', group: { start_type: 'startup' }, value: 4 },
        { bucket: '2026-11-03T00:00:00+01:00', group: { start_type: 'resume' }, value: 1 },
      ],
      meta: {},
    })
    await renderWidget('sessions-per-day', clientWith({ queryMetrics }))

    const table = within(await screen.findByRole('table'))
    expect(table.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Day',
      'startup',
      'resume',
    ])
  })

  it('draws Model mix as shares of the cost, named by model', async () => {
    const queryMetrics = vi.fn<Call>().mockResolvedValue({
      rows: [
        { group: { model: 'claude-opus-4-7' }, value: 30 },
        { group: { model: 'claude-haiku-4-5' }, value: 10 },
      ],
      meta: {},
    })
    await renderWidget('model-mix', clientWith({ queryMetrics }))

    // The chart's data table: a row per model with its cost and share.
    const table = within(await screen.findByRole('table'))
    expect(table.getByRole('row', { name: /claude-opus-4-7/ })).toHaveTextContent('75%')
    expect(table.getByRole('row', { name: /claude-haiku-4-5/ })).toHaveTextContent('25%')
  })

  it('draws Tokens by type as a stacked series with a column per type', async () => {
    const queryMetrics = vi.fn<Call>().mockResolvedValue({
      rows: [
        { bucket: '2026-11-03T00:00:00+01:00', group: { type: 'input' }, value: 10 },
        { bucket: '2026-11-03T00:00:00+01:00', group: { type: 'cacheRead' }, value: 900 },
        { bucket: '2026-11-04T00:00:00+01:00', group: { type: 'input' }, value: 12 },
      ],
      meta: {},
    })
    await renderWidget('tokens-by-type', clientWith({ queryMetrics }))

    const table = within(await screen.findByRole('table'))
    expect(table.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Day',
      'cacheRead',
      'input',
    ])
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
