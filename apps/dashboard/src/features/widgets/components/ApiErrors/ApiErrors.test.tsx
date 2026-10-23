import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { renderWidget } from '#test/renderWidget'

const headers = (table: HTMLElement) =>
  within(table)
    .getAllByRole('columnheader')
    .map((cell) => cell.textContent)

describe('API errors', () => {
  it('has a column per status', async () => {
    renderWidget('api-errors', [
      { bucket: '2026-11-03T00:00:00+01:00', group: { status_code: 529 }, value: 4 },
      { bucket: '2026-11-03T00:00:00+01:00', group: { status_code: 429 }, value: 2 },
    ])
    expect(headers(await screen.findByRole('table'))).toEqual(['At', '529', '429'])
  })
})
