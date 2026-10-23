import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import type { Inventory } from '#features/filters/data/inventory'
import { defaultLimit } from '#features/widgets/constants/queryOptions'

import { QueryWidgetEditor } from './QueryWidgetEditor'
import type { QueryWidgetValue } from './QueryWidgetEditor'

// Radix Select uses pointer-capture and scroll APIs jsdom lacks.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => undefined
  Element.prototype.releasePointerCapture = () => undefined
  Element.prototype.scrollIntoView = () => undefined
})

const inventory: Inventory = {
  owners: [],
  sources: [],
  accounts: [],
  services: ['claude-code'],
  models: [],
  metrics: [
    { name: 'claude_code.cost.usage', kind: 'sum', unit: 'USD', service_name: 'claude-code' },
    { name: 'claude_code.token.usage', kind: 'sum', unit: 'tokens', service_name: 'claude-code' },
  ],
  events: [{ name: 'tool_result', service_name: 'claude-code' }],
  attributes: [
    { signal: 'metric', key: 'model', promoted: true },
    { signal: 'metric', key: 'type', promoted: false },
    { signal: 'event', key: 'tool_name', promoted: false },
  ],
}

function setup() {
  const onSave = vi.fn<(value: QueryWidgetValue) => void>()
  const onOpenChange = vi.fn<(open: boolean) => void>()
  const user = userEvent.setup()
  render(
    <QueryWidgetEditor
      open
      onOpenChange={onOpenChange}
      inventory={inventory}
      onSave={onSave}
    />,
  )
  return { user, onSave, onOpenChange }
}

/** Picks an option of a Kiln `Select` by its visible name. */
async function choose(user: ReturnType<typeof userEvent.setup>, field: string, option: string) {
  await user.click(screen.getByRole('combobox', { name: field }))
  await user.click(await screen.findByRole('option', { name: option }))
}

describe('QueryWidgetEditor', () => {
  it('saves a Query Widget built from the Inventory, with the default limit', async () => {
    const { user, onSave } = setup()

    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Spend')
    await user.click(screen.getByRole('combobox', { name: 'Metric' }))
    await user.click(await screen.findByRole('option', { name: /claude_code\.cost\.usage/ }))
    await user.click(screen.getByRole('button', { name: 'Save Query Widget' }))

    expect(onSave).toHaveBeenCalledExactlyOnceWith({
      title: 'Spend',
      query: {
        source: { kind: 'metric', name: 'claude_code.cost.usage', aggregation: 'sum' },
        groupBy: [],
        filter: [],
        chart: 'stat',
        limit: defaultLimit,
      },
    })
  })

  it('will not save a Query Widget the Query API would refuse, and says what is wrong', async () => {
    const { user, onSave } = setup()

    await user.click(screen.getByRole('button', { name: 'Save Query Widget' }))

    expect(onSave).not.toHaveBeenCalled()
    expect(await screen.findByRole('alert', { name: /can't be saved yet/ })).toHaveTextContent(
      'Name the Widget. Pick a Metric.',
    )
  })

  it('disables a chart kind the rows cannot draw and gives the reason', async () => {
    const { user } = setup()

    expect(screen.getByRole('combobox', { name: 'Chart' })).toHaveAccessibleDescription(
      /Line: A line needs a time bucket\./,
    )
    await user.click(screen.getByRole('combobox', { name: 'Chart' }))
    expect(await screen.findByRole('option', { name: 'Line (unavailable)' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByRole('option', { name: 'Number' })).not.toHaveAttribute('aria-disabled')
    expect(screen.getByRole('option', { name: 'Table' })).not.toHaveAttribute('aria-disabled')
  })

  it('moves the chart to one that can draw the rows when the shape changes', async () => {
    const { user, onSave } = setup()

    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Per day')
    await user.click(screen.getByRole('combobox', { name: 'Metric' }))
    await user.click(await screen.findByRole('option', { name: /claude_code\.cost\.usage/ }))
    // A number cannot be split by time: choosing a bucket moves the chart off it.
    await choose(user, 'Time bucket', 'day')
    await user.click(screen.getByRole('button', { name: 'Save Query Widget' }))

    expect(onSave.mock.calls[0]?.[0].query).toMatchObject({ bucket: 'day', chart: 'series' })
  })

  it('moves an undrawable chart to one that fits when the Signal changes', async () => {
    const { user, onSave } = setup()

    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Spend by model')
    await user.click(screen.getByRole('combobox', { name: 'Metric' }))
    await user.click(await screen.findByRole('option', { name: /claude_code\.cost\.usage/ }))
    await user.click(screen.getByRole('combobox', { name: 'Group by' }))
    await user.click(await screen.findByRole('option', { name: 'model' }))
    await choose(user, 'Chart', 'Bar list')

    // Switching to an Event clears Group by, which a bar list cannot draw without.
    await choose(user, 'Signal', 'Event')
    await user.click(screen.getByRole('combobox', { name: 'Event' }))
    await user.click(await screen.findByRole('option', { name: 'tool_result' }))
    await user.click(screen.getByRole('button', { name: 'Save Query Widget' }))

    expect(onSave.mock.calls[0]?.[0].query).toMatchObject({
      source: { kind: 'event', name: 'tool_result' },
      groupBy: [],
      chart: 'stat',
    })
  })

  it('adds and removes a filter row', async () => {
    const { user } = setup()

    await user.click(screen.getByRole('button', { name: 'Add filter' }))
    expect(screen.getByRole('group', { name: 'Filter 1' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove filter 1' }))
    expect(screen.queryByRole('group', { name: 'Filter 1' })).not.toBeInTheDocument()
  })

  it('closes without saving on Cancel', async () => {
    const { user, onSave, onOpenChange } = setup()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onSave).not.toHaveBeenCalled()
  })
})
