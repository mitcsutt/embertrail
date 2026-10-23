import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeAll, describe, expect, it } from 'vitest'

import type { Inventory } from '#features/filters/data/inventory'
import type { BoardFilters } from '#features/filters/types/filters'

import { FilterBar } from './FilterBar'

// Radix Select, under the range control, uses pointer-capture and scroll APIs jsdom lacks.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => undefined
  Element.prototype.releasePointerCapture = () => undefined
  Element.prototype.scrollIntoView = () => undefined
})

const inventory: Inventory = {
  owners: [{ id: 'u1', kind: 'user', name: 'u1' }],
  sources: [
    { id: 'src-laptop', name: 'Laptop', owner_id: 'u1' },
    { id: 'src-desktop', name: 'Desktop', owner_id: 'u1' },
  ],
  accounts: [
    {
      id: 'acc-work',
      label: 'Work',
      owner_id: 'u1',
      organization_id: null,
      account_uuid: null,
      email: 'dev@example.com',
    },
  ],
  services: ['claude-code'],
  models: ['claude-opus-4', 'claude-sonnet-4'],
  metrics: [],
  events: [],
  attributes: [],
}

const now = new Date('2026-11-04T12:00:00Z')

/** The bar over real state, and the filters the parent last saw. */
function Harness({ initial, seen }: { initial: BoardFilters; seen: BoardFilters[] }) {
  const [filters, setFilters] = useState(initial)
  return (
    <FilterBar
      filters={filters}
      onChange={(patch) => {
        const next = { ...filters, ...patch }
        seen.push(next)
        setFilters(next)
      }}
      inventory={inventory}
      tz="Europe/Berlin"
      now={now}
    />
  )
}

const week: BoardFilters = { time: { kind: 'relative', range: 'last-7-days' } }

describe('FilterBar', () => {
  it('picks a relative range with the keyboard alone', async () => {
    const user = userEvent.setup()
    const seen: BoardFilters[] = []
    render(<Harness initial={week} seen={seen} />)

    await user.tab()
    expect(screen.getByRole('combobox', { name: 'Time range' })).toHaveFocus()
    await user.keyboard('{Enter}')
    await screen.findByRole('listbox')
    // The list opens on the current range, Last 7 days: two up is Yesterday.
    await user.keyboard('{ArrowUp}{ArrowUp}{Enter}')

    expect(seen.at(-1)?.time).toEqual({ kind: 'relative', range: 'yesterday' })
  })

  it('moves between the controls in order with Tab', async () => {
    const user = userEvent.setup()
    render(<Harness initial={week} seen={[]} />)

    await user.tab()
    for (const name of ['Time range', 'Source', 'Account', 'Model']) {
      expect(screen.getByRole('combobox', { name })).toHaveFocus()
      await user.tab()
    }
  })

  it('picks a Source by typing and Enter, then clears it', async () => {
    const user = userEvent.setup()
    const seen: BoardFilters[] = []
    render(<Harness initial={week} seen={seen} />)

    await user.click(screen.getByRole('combobox', { name: 'Source' }))
    await user.keyboard('desk{Enter}')
    expect(seen.at(-1)?.sourceId).toBe('src-desktop')

    await user.click(screen.getByRole('button', { name: 'Clear Source' }))
    expect(seen.at(-1)?.sourceId).toBeUndefined()
  })

  it('labels an Account by its label, with the email under it', async () => {
    const user = userEvent.setup()
    render(<Harness initial={week} seen={[]} />)

    await user.click(screen.getByRole('combobox', { name: 'Account' }))

    const option = await screen.findByRole('option', { name: /Work/ })
    expect(option).toHaveTextContent('dev@example.com')
  })

  it('picks a model with the arrow keys', async () => {
    const user = userEvent.setup()
    const seen: BoardFilters[] = []
    render(<Harness initial={week} seen={seen} />)

    await user.click(screen.getByRole('combobox', { name: 'Model' }))
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')

    expect(seen.at(-1)?.model).toBe('claude-sonnet-4')
  })

  it('shows a saved pick the window no longer holds', () => {
    render(<Harness initial={{ ...week, model: 'claude-old' }} seen={[]} />)

    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveValue('claude-old')
  })

  it('switches to a custom range that starts as the dates the range covered', async () => {
    const user = userEvent.setup()
    const seen: BoardFilters[] = []
    render(<Harness initial={week} seen={seen} />)

    await user.tab()
    await user.keyboard('{Enter}')
    await user.click(await screen.findByRole('option', { name: 'Custom…' }))

    expect(seen.at(-1)?.time).toEqual({ kind: 'absolute', from: '2026-10-29', to: '2026-11-04' })
    expect(screen.getByRole('group', { name: /dates/i })).toBeInTheDocument()
  })

  it('shows no custom dates for a relative range', () => {
    render(<Harness initial={week} seen={[]} />)

    expect(screen.queryByRole('group', { name: /dates/i })).not.toBeInTheDocument()
  })
})
