import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { renderWidget } from '#test/renderWidget'

const headers = (table: HTMLElement) =>
  within(table)
    .getAllByRole('columnheader')
    .map((cell) => cell.textContent)

describe('Request latency', () => {
  it('has a column per model, written as durations', async () => {
    renderWidget('request-latency', [
      { bucket: '2026-11-03T00:00:00+01:00', group: { model: 'claude-opus-4-7' }, value: 8_400 },
      { bucket: '2026-11-03T00:00:00+01:00', group: { model: 'claude-haiku-4-5' }, value: 900 },
    ])
    const table = await screen.findByRole('table')
    expect(headers(table)).toEqual(['At', 'claude-opus-4-7', 'claude-haiku-4-5'])
    expect(table).toHaveTextContent('8 s')
    expect(table).toHaveTextContent('900 ms')
  })
})
