import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { renderWidget } from '#test/renderWidget'

const headers = (table: HTMLElement) =>
  within(table)
    .getAllByRole('columnheader')
    .map((cell) => cell.textContent)

describe('Today by hour vs typical', () => {
  it('has a row for every hour, with today stopping at the current one', async () => {
    renderWidget('today-by-hour-vs-typical', [
      { bucket: '2026-11-03T09:00:00+01:00', group: {}, value: 2 },
      { bucket: '2026-11-04T09:00:00+01:00', group: {}, value: 5 },
    ])
    const table = await screen.findByRole('table')
    expect(headers(table)).toEqual(['Hour', 'Today', 'Typical day'])
    expect(within(table).getAllByRole('row')).toHaveLength(25)
    // The time is 09:30, so hour 10 is not reached and today is blank there.
    const row = within(table).getByRole('row', { name: /^10:00/ })
    expect(within(row).getAllByRole('cell')[0]).toHaveTextContent(/^–?$/)
  })

  it('is empty when the Hub holds no cost', async () => {
    renderWidget('today-by-hour-vs-typical', [])
    expect(await screen.findByText('Nothing to show for this period')).toBeInTheDocument()
  })
})
