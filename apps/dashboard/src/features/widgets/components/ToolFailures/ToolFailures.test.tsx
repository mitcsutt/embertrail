import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { renderWidget } from '#test/renderWidget'

const headers = (table: HTMLElement) =>
  within(table)
    .getAllByRole('columnheader')
    .map((cell) => cell.textContent)

describe('Tool failures', () => {
  it('pivots outcomes into calls, failures and a rate, worst first', async () => {
    renderWidget('tool-failures', [
      { group: { tool_name: 'Read', success: true }, value: 30 },
      { group: { tool_name: 'Bash', success: true }, value: 88 },
      { group: { tool_name: 'Bash', success: false }, value: 12 },
    ])
    const table = await screen.findByRole('table')
    expect(headers(table)).toEqual(['Tool', 'Calls', 'Failed', 'Failure rate'])
    const [bash, read] = within(table).getAllByRole('row').slice(1)
    expect(bash).toHaveTextContent(/Bash.*100.*12.*12%/)
    expect(read).toHaveTextContent(/Read.*30.*0.*0%/)
  })

  it('counts the string "false" Claude Code sends as a failure', async () => {
    renderWidget('tool-failures', [
      { group: { tool_name: 'Bash', success: 'true' }, value: 90 },
      { group: { tool_name: 'Bash', success: 'false' }, value: 10 },
    ])
    const table = await screen.findByRole('table')
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent(/Bash.*100.*10.*10%/)
  })
})
