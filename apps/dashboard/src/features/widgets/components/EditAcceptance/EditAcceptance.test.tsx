import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { renderWidget } from '#test/renderWidget'

describe('Edit acceptance', () => {
  it('names the decisions', async () => {
    renderWidget('edit-acceptance', [
      { group: { decision: 'accept' }, value: 85 },
      { group: { decision: 'reject' }, value: 15 },
    ])
    expect((await screen.findAllByText('Accepted')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Rejected').length).toBeGreaterThan(0)
  })
})
