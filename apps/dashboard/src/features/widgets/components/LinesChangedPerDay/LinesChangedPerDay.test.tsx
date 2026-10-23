import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { renderWidget } from '#test/renderWidget'

const headers = (table: HTMLElement) =>
  within(table)
    .getAllByRole('columnheader')
    .map((cell) => cell.textContent)

describe('Lines changed per day', () => {
  it('has a column for added lines and one for removed lines', async () => {
    renderWidget('lines-changed-per-day', [
      { bucket: '2026-11-03T00:00:00+01:00', group: { type: 'added' }, value: 40 },
      { bucket: '2026-11-03T00:00:00+01:00', group: { type: 'removed' }, value: 10 },
    ])
    expect(headers(await screen.findByRole('table'))).toEqual(['Day', 'Added', 'Removed'])
  })
})
