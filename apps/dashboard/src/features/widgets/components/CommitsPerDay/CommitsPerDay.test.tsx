import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { renderWidget } from '#test/renderWidget'

const headers = (table: HTMLElement) =>
  within(table)
    .getAllByRole('columnheader')
    .map((cell) => cell.textContent)

describe('Commits per day', () => {
  it('has a column of commits', async () => {
    renderWidget('commits-per-day', [{ bucket: '2026-11-03T00:00:00+01:00', group: {}, value: 3 }])
    expect(headers(await screen.findByRole('table'))).toEqual(['Day', 'Commits'])
  })
})
