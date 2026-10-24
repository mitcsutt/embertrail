// Locale and currency in jsdom, against an in-memory Hub (`fakeHub`): costs are converted at the
// Hub's daily rate and marked as estimates, a Hub without rates leaves USD and says so, and the
// header control saves the choice in the browser.

import type { Schemas } from '@mitcsutt/embertrail-client'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { fakeHub } from './fakeHub.ts'
import { openBoard } from './openBoard.tsx'

// Radix Select and Popover use pointer capture and scrolling, which jsdom lacks.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => undefined
  Element.prototype.releasePointerCapture = () => undefined
  Element.prototype.scrollIntoView = () => undefined
})

afterEach(() => {
  localStorage.clear()
})

const rates = (over: Partial<Schemas['Rates']> = {}): Schemas['Rates'] => ({
  status: 'ok',
  base: 'USD',
  source: 'ecb',
  date: '2026-11-03',
  fetched_at: '2026-11-03T16:30:00Z',
  rates: { USD: 1, AUD: 1.5, EUR: 0.9 },
  ...over,
})

const session: Schemas['SessionSummary'] = {
  id: 'aaaaaaaa-root',
  service_name: 'claude-code',
  owner_id: 'u1',
  source_id: 's1',
  account_id: null,
  started_at: '2026-11-03T10:00:00Z',
  last_seen_at: '2026-11-03T11:00:00Z',
  models: ['claude-opus-4-7'],
  cost_usd: 10,
  tokens: { input: 1000, output: 500 },
  event_counts: { api_request: 2 },
  group: null,
  parent_session_id: null,
  role: null,
  labels: {},
}

const choose = (currency: string, locale?: string) => {
  localStorage.setItem(
    'embertrail-dashboard-locale',
    JSON.stringify({ locale: locale ?? 'en-AU', currency }),
  )
}

describe('costs in another currency', () => {
  it('converts at the Hub’s rate, marks the figure as an estimate and says which rate', async () => {
    choose('AUD')
    openBoard('/sessions', fakeHub({ sessions: [session], rates: rates() }).client)

    const note = await screen.findByTestId('money-note')
    expect(note).toHaveTextContent(/estimates in AUD/)
    expect(note).toHaveTextContent('1 USD = 1.5000 AUD')
    expect(note).toHaveTextContent(/ECB reference rate, 3 Nov 2026/)
    const tree = await screen.findByRole('treegrid', { name: 'Session Groups' })
    expect(await within(tree).findAllByText(/≈\s*\$15\.00/)).not.toHaveLength(0)
    expect(within(tree).queryByText('$10.00')).not.toBeInTheDocument()
  })

  it('says the rate is the latest the Hub could fetch when it is stale', async () => {
    choose('AUD')
    openBoard(
      '/sessions',
      fakeHub({ sessions: [session], rates: rates({ status: 'stale' }) }).client,
    )
    expect(await screen.findByTestId('money-note')).toHaveTextContent(/latest this Hub could fetch/)
  })

  it('stays on USD, and says why, when the Hub fetches no rates', async () => {
    choose('AUD')
    openBoard('/sessions', fakeHub({ sessions: [session] }).client)

    expect(await screen.findByTestId('money-note')).toHaveTextContent(
      'Showing USD, as Claude Code reports it: you asked for AUD, but this Hub does not fetch exchange rates.',
    )
    const tree = await screen.findByRole('treegrid', { name: 'Session Groups' })
    expect(await within(tree).findAllByText(/USD\s10\.00/)).not.toHaveLength(0)
  })

  it('stays on USD when the Hub has no rate for the currency', async () => {
    choose('XTS')
    openBoard('/sessions', fakeHub({ sessions: [session], rates: rates() }).client)
    expect(await screen.findByTestId('money-note')).toHaveTextContent(/there is no exchange rate/)
  })

  it('shows nothing about currency for a viewer on USD', async () => {
    openBoard('/sessions', fakeHub({ sessions: [session], rates: rates() }).client)
    const tree = await screen.findByRole('treegrid', { name: 'Session Groups' })
    expect(await within(tree).findAllByText('$10.00')).not.toHaveLength(0)
    expect(screen.queryByTestId('money-note')).not.toBeInTheDocument()
  })

  it('defaults the currency from the browser’s locale', async () => {
    const language = vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-AU')
    try {
      openBoard('/sessions', fakeHub({ sessions: [session], rates: rates() }).client)
      expect(await screen.findByTestId('money-note')).toHaveTextContent(/estimates in AUD/)
    } finally {
      language.mockRestore()
    }
  })
})

describe('the header control', () => {
  it('saves the choice in this browser and applies it at once', async () => {
    const user = userEvent.setup()
    openBoard('/sessions', fakeHub({ sessions: [session], rates: rates() }).client)

    await user.click(await screen.findByRole('button', { name: /^Language and currency/ }))
    await user.click(await screen.findByRole('combobox', { name: 'Currency' }))
    await user.click(await screen.findByRole('option', { name: /^EUR/ }))

    await waitFor(() => {
      expect(screen.getByTestId('money-note')).toHaveTextContent(/estimates in EUR/)
    })
    expect(JSON.parse(localStorage.getItem('embertrail-dashboard-locale') ?? '{}')).toEqual({
      locale: null,
      currency: 'EUR',
    })
  })
})
