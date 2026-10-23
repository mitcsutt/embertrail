import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { renderWidget } from '#test/renderWidget'

const headers = (table: HTMLElement) =>
  within(table)
    .getAllByRole('columnheader')
    .map((cell) => cell.textContent)

describe('Active time per day', () => {
  it('has a column for you and one for Claude, written as durations', async () => {
    renderWidget('active-time-per-day', [
      { bucket: '2026-11-03T00:00:00+01:00', group: { type: 'user' }, value: 4_800 },
      { bucket: '2026-11-03T00:00:00+01:00', group: { type: 'cli' }, value: 600 },
    ])
    const table = await screen.findByRole('table')
    expect(headers(table)).toEqual(['Day', 'You', 'Claude'])
    expect(table).toHaveTextContent('1 h 20 min')
    expect(table).toHaveTextContent('10 min')
  })
})
