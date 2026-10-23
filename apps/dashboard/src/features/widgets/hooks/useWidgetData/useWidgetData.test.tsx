import { ProblemError, type EmbertrailClient } from '@mitcsutt/embertrail-client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { QueryContext } from '#features/filters/types/filters'
import { costByAccount } from '#features/widgets/components/CostByAccount'
import { costToday } from '#features/widgets/components/CostToday'
import { HubContext } from '#lib/hub'

import { useWidgetData } from './useWidgetData'

const ctx: QueryContext = {
  from: '2026-11-04T00:00:00+01:00',
  to: '2026-11-05T00:00:00+01:00',
  tz: 'Europe/Berlin',
  filter: [],
  now: new Date('2026-11-04T13:00:00Z'),
  sessions: {},
}

const hubFor = (client: EmbertrailClient) => ({ client, hubUrl: '', display: 'http://localhost' })

function setup() {
  const queryMetrics = vi.fn().mockResolvedValue({ rows: [{ group: {}, value: 5 }], meta: {} })
  const client = { queryMetrics } as unknown as EmbertrailClient
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000 } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <HubContext value={hubFor(client)}>{children}</HubContext>
    </QueryClientProvider>
  )
  return { queryMetrics, wrapper }
}

describe('useWidgetData', () => {
  it('goes from loading to ready with the selected data', async () => {
    const { wrapper } = setup()
    const { result } = renderHook(() => useWidgetData(costToday, ctx), { wrapper })

    expect(result.current.status).toBe('loading')
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })
    expect(result.current.data).toEqual({ cost: 5 })
  })

  it('asks the Hub once for a request it has already sent, and again for a new one', async () => {
    const { queryMetrics, wrapper } = setup()
    const { result, rerender } = renderHook(
      ({ context }: { context: QueryContext }) => useWidgetData(costToday, context),
      { wrapper, initialProps: { context: ctx } },
    )
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    // Another context object that builds the same request (a Board filter this Widget ignores).
    rerender({ context: { ...ctx, now: new Date('2026-11-04T14:00:00Z') } })
    expect(queryMetrics).toHaveBeenCalledOnce()
    expect(result.current.status).toBe('ready')

    // A different window is a different request.
    rerender({ context: { ...ctx, to: '2026-11-06T00:00:00+01:00' } })
    await waitFor(() => {
      expect(queryMetrics).toHaveBeenCalledTimes(2)
    })
  })

  it('reports an error and does not retry a problem the Hub answered', async () => {
    const queryMetrics = vi.fn().mockRejectedValue(
      new ProblemError({
        type: 'urn:embertrail:problem:validation',
        title: 'Invalid',
        status: 400,
        request_id: 'r1',
      }),
    )
    const failing = {
      queryMetrics: queryMetrics,
    } as unknown as EmbertrailClient
    const { result } = renderHook(() => useWidgetData(costToday, ctx), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <HubContext value={hubFor(failing)}>{children}</HubContext>
        </QueryClientProvider>
      ),
    })
    await waitFor(() => {
      expect(result.current.status).toBe('error')
    })
    expect(queryMetrics).toHaveBeenCalledOnce()
  })

  it('asks for the Inventory only for a Widget that wants it, and waits for it', async () => {
    const queryMetrics = vi.fn().mockResolvedValue({
      rows: [{ group: { 'embertrail.account_id': 'a' }, value: 2 }],
      meta: {},
    })
    let answer: (inventory: unknown) => void = () => undefined
    const getInventory = vi.fn<(input: { query: unknown }) => Promise<unknown>>().mockReturnValue(
      new Promise((resolve) => {
        answer = resolve
      }),
    )
    const client = { queryMetrics, getInventory } as unknown as EmbertrailClient
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000 } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <HubContext value={hubFor(client)}>{children}</HubContext>
      </QueryClientProvider>
    )

    const { result: plain } = renderHook(() => useWidgetData(costToday, ctx), { wrapper })
    await waitFor(() => {
      expect(plain.current.status).toBe('ready')
    })
    expect(getInventory).not.toHaveBeenCalled()
    expect(plain.current.inventory).toBeUndefined()

    const { result } = renderHook(() => useWidgetData(costByAccount, ctx), { wrapper })
    await waitFor(() => {
      expect(getInventory).toHaveBeenCalledOnce()
    })
    // The rows are in; the names are not.
    expect(result.current.status).toBe('loading')
    answer({ accounts: [{ id: 'a', label: 'Work' }] })
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })
    expect(result.current.inventory).toEqual({ accounts: [{ id: 'a', label: 'Work' }] })
    expect(getInventory.mock.calls[0]?.[0].query).toEqual({ from: ctx.from, to: ctx.to })
  })
})
