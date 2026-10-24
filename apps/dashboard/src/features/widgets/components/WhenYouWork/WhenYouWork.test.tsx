import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { renderWidget } from '#test/renderWidget'

describe('When you work', () => {
  it('is a grid of weekdays by hour, Monday first', async () => {
    renderWidget('when-you-work', [
      // A Monday and a Sunday in Berlin.
      { bucket: '2026-11-02T09:00:00+01:00', group: {}, value: 3_600 },
      { bucket: '2026-11-08T22:00:00+01:00', group: {}, value: 120 },
    ])
    const grid = await screen.findByRole('grid')
    const rows = within(grid).getAllByRole('row')
    expect(rows).toHaveLength(8)
    expect(
      rows.slice(1).map((row) => within(row).getAllByRole('rowheader')[0]?.textContent),
    ).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
    expect(within(grid).getAllByRole('columnheader')).toHaveLength(24)
    expect(rows[1]).toHaveTextContent('1 h')
    expect(rows[7]).toHaveTextContent('2 min')
  })

  it('is empty when the Hub holds no active time', async () => {
    renderWidget('when-you-work', [])
    expect(await screen.findByText('Nothing recorded in this period')).toBeInTheDocument()
  })
})
