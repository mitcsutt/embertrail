import { ProblemError } from '@mitcsutt/embertrail-client'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { WidgetFrame } from './WidgetFrame'

const problem = new ProblemError({
  type: 'urn:embertrail:problem:too-many-rows',
  title: 'Too many rows',
  status: 422,
  detail: 'The query matches 12,000 rows; set a limit.',
  request_id: 'r1',
})

describe('WidgetFrame', () => {
  it('draws the Widget and its title when ready', () => {
    render(
      <WidgetFrame title="Cost today" status="ready">
        <p>the widget</p>
      </WidgetFrame>,
    )
    expect(screen.getByRole('heading', { name: 'Cost today' })).toBeInTheDocument()
    expect(screen.getByText('the widget')).toBeInTheDocument()
  })

  it('shows loading in place of the Widget', () => {
    render(
      <WidgetFrame title="Cost today" status="loading">
        <p>the widget</p>
      </WidgetFrame>,
    )
    expect(screen.queryByText('the widget')).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Cost today' })).toBeInTheDocument()
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('shows empty in place of the Widget', () => {
    render(
      <WidgetFrame title="Cost today" status="empty">
        <p>the widget</p>
      </WidgetFrame>,
    )
    expect(screen.queryByText('the widget')).not.toBeInTheDocument()
    expect(screen.getByText('Nothing to show for this period')).toBeInTheDocument()
  })

  it("shows the Hub's detail on error, with a Retry that retries", async () => {
    const onRetry = vi.fn()
    render(
      <WidgetFrame title="Cost today" status="error" error={problem} onRetry={onRetry}>
        <p>the widget</p>
      </WidgetFrame>,
    )
    expect(screen.queryByText('the widget')).not.toBeInTheDocument()
    expect(screen.getByText('The query matches 12,000 rows; set a limit.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('leaves the title to a stat, which names itself', () => {
    render(
      <WidgetFrame title="Cost today" status="ready" showTitle={false}>
        <p>the widget</p>
      </WidgetFrame>,
    )
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Cost today' })).toBeInTheDocument()
  })
})
