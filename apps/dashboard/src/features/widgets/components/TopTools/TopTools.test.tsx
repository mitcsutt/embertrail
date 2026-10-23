import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { renderWidget } from '#test/renderWidget'

describe('Top tools', () => {
  it('lists each tool with its call count, most called first', async () => {
    renderWidget('top-tools', [
      { group: { tool_name: 'Read' }, value: 30 },
      { group: { tool_name: 'Bash' }, value: 12 },
    ])
    const items = await screen.findAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringMatching(/^Read.*30/),
      expect.stringMatching(/^Bash.*12/),
    ])
  })

  it('is empty when no tool was called', async () => {
    renderWidget('top-tools', [])
    expect(await screen.findByText('Nothing to show for this period')).toBeInTheDocument()
  })
})
