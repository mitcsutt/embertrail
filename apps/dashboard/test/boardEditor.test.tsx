// Edit mode against an in-memory Hub (`fakeHub`), which checks `If-Match` as the Hub does: customise
// a Preset, move and resize by keyboard alone, add, remove and pin, save, and meet a conflict.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it } from 'vitest'

import { boardSchema } from '#features/boards/schemas/board'
import type { BoardDocument } from '#features/boards/types/board'
import { overviewPreset } from '#features/boards/utils/presets'

import { fakeHub } from './fakeHub.ts'
import { openBoard } from './openBoard.tsx'

// Radix Select and Popover use pointer capture and scrolling, which jsdom lacks.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => undefined
  Element.prototype.releasePointerCapture = () => undefined
})

const id = 'b-spend00001'

const stored: BoardDocument = {
  schema_version: 1,
  name: 'My spend',
  filters: { time: { kind: 'relative', range: 'last-7-days' } },
  items: [
    { i: 'head', type: 'section', title: 'Money' },
    { i: 'a', type: 'widget', widget: 'cost-today' },
    { i: 'b', type: 'widget', widget: 'model-mix' },
  ],
  layout: [
    { i: 'head', x: 0, y: 0, w: 12, h: 1, static: true },
    { i: 'a', x: 0, y: 1, w: 3, h: 2 },
    { i: 'b', x: 3, y: 1, w: 4, h: 4 },
  ],
}

const hubWithBoard = () => fakeHub({ boards: { [id]: stored } })
const savedBoard = (hub: ReturnType<typeof fakeHub>): BoardDocument => {
  const board = hub.board(id)
  return boardSchema.parse(board)
}
const cell = (board: BoardDocument, item: string) => board.layout.find(({ i }) => i === item)

describe('customising a Preset', () => {
  it('stores a copy and opens it in the editor, leaving the Preset as it was', async () => {
    const hub = fakeHub()
    const user = userEvent.setup()
    const { router } = openBoard('/boards/overview', hub.client)

    await user.click(await screen.findByRole('button', { name: 'Customise' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Edit Board' })).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Board name' })).toHaveValue('Overview (copy)')
    expect(screen.queryByText('That did not work')).not.toBeInTheDocument()
    expect(router.state.location.pathname).toMatch(/^\/boards\/b-[a-z0-9]{10}$/)
    expect(router.state.location.search).toEqual({ edit: true })
    const puts = hub.requests.filter(({ line }) => line.startsWith('PUT '))
    expect(puts).toHaveLength(1)
    expect(puts[0]?.body).toEqual({ data: { ...overviewPreset, name: 'Overview (copy)' } })

    await router.navigate({ to: '/boards/$boardId', params: { boardId: 'overview' } })
    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeVisible()
    expect(overviewPreset.name).toBe('Overview')
  })

  it('offers neither Customise nor Edit without store:write', async () => {
    const hub = fakeHub({ boards: { [id]: stored }, scopes: ['otel:read', 'store:read'] })
    openBoard(`/boards/${id}?edit=true`, hub.client)

    expect(await screen.findByRole('heading', { level: 1, name: 'My spend' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Edit Board' })).not.toBeInTheDocument()
  })
})

describe('moving and resizing', () => {
  it('moves and resizes a Widget with the keyboard alone, and the Layout is saved', async () => {
    const hub = hubWithBoard()
    const user = userEvent.setup()
    openBoard(`/boards/${id}`, hub.client)

    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    const handle = await screen.findByRole('button', { name: /Move Cost today/ })
    handle.focus()
    // Space picks it up, an arrow moves it one cell, Shift and an arrow resizes it, Space drops it.
    await user.keyboard(' {ArrowDown}{Shift>}{ArrowRight}{/Shift} ')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(savedBoard(hub)).not.toEqual(stored)
    })
    const after = savedBoard(hub)
    expect(cell(after, 'a')).not.toEqual(cell(stored, 'a'))
    expect(cell(after, 'a')?.w).toBe(4)
    // Back in view mode, with the saved Layout on a fresh read.
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })

  it('saves nothing when the draft has not changed', async () => {
    const hub = hubWithBoard()
    const user = userEvent.setup()
    openBoard(`/boards/${id}?edit=true`, hub.client)

    expect(await screen.findByRole('button', { name: 'Save' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeVisible()
    expect(hub.requests.filter(({ line }) => line.startsWith('PUT '))).toHaveLength(0)
  })
})

describe('adding and removing', () => {
  it('adds a Widget from the Catalogue, focuses its handle, and saves it', async () => {
    const hub = hubWithBoard()
    const user = userEvent.setup()
    openBoard(`/boards/${id}?edit=true`, hub.client)

    await user.click(await screen.findByRole('button', { name: 'Add Widget' }))
    const sheet = within(await screen.findByRole('dialog', { name: 'Add a Widget' }))
    await user.type(sheet.getByRole('searchbox', { name: 'Search the Catalogue' }), 'tokens')
    expect(sheet.queryByRole('button', { name: 'Add Cost today' })).not.toBeInTheDocument()
    await user.click(sheet.getByRole('button', { name: 'Add Tokens by type' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Move Tokens by type/ })).toHaveFocus()
    })
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(savedBoard(hub).items.map(({ i }) => i)).toEqual(['head', 'a', 'b', 'tokens-by-type'])
    })
    expect(cell(savedBoard(hub), 'tokens-by-type')?.y).toBeGreaterThanOrEqual(5)
  })

  it('adds a section and removes a Widget', async () => {
    const hub = hubWithBoard()
    const user = userEvent.setup()
    openBoard(`/boards/${id}?edit=true`, hub.client)

    await user.click(await screen.findByRole('button', { name: 'Add section' }))
    await user.type(await screen.findByRole('textbox', { name: 'Section title' }), 'Later')
    await user.click(screen.getByRole('button', { name: 'Add section', description: '' }))
    await user.click(await screen.findByRole('button', { name: 'Remove Model mix' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(savedBoard(hub).items).toEqual([
        { i: 'head', type: 'section', title: 'Money' },
        { i: 'a', type: 'widget', widget: 'cost-today' },
        { i: 'section-later', type: 'section', title: 'Later' },
      ])
    })
  })
})

describe('pinned filters', () => {
  it('pins a model on one Widget, and the frame says so', async () => {
    const hub = hubWithBoard()
    const user = userEvent.setup()
    openBoard(`/boards/${id}?edit=true`, hub.client)

    await user.click(await screen.findByRole('button', { name: 'Pin filters for Model mix' }))
    const popover = within(
      await screen.findByRole('dialog', { name: 'Pinned filters for Model mix' }),
    )
    await user.click(popover.getByRole('combobox', { name: 'Model' }))
    await user.click(await screen.findByRole('option', { name: 'claude-opus-4-7' }))

    expect(await screen.findByText(/Pinned: model/)).toBeVisible()
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(savedBoard(hub).items[2]).toEqual({
        i: 'b',
        type: 'widget',
        widget: 'model-mix',
        override: { model: 'claude-opus-4-7' },
      })
    })
  })

  it('saves the filters in force as the Board default', async () => {
    const hub = hubWithBoard()
    const user = userEvent.setup()
    openBoard(`/boards/${id}?edit=true&range=last-30-days`, hub.client)

    await user.click(
      await screen.findByRole('button', { name: 'Use these filters as the default' }),
    )
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(savedBoard(hub).filters).toEqual({ time: { kind: 'relative', range: 'last-30-days' } })
    })
  })
})

describe('a Board that changed elsewhere', () => {
  const elsewhere = { ...stored, name: 'Renamed by someone else' }

  it('says so instead of overwriting, and Keep editing leaves the draft', async () => {
    const hub = hubWithBoard()
    const user = userEvent.setup()
    openBoard(`/boards/${id}?edit=true`, hub.client)

    const name = await screen.findByRole('textbox', { name: 'Board name' })
    await user.clear(name)
    await user.type(name, 'My own rename')
    hub.saveElsewhere(id, elsewhere)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    const dialog = within(
      await screen.findByRole('dialog', { name: 'This Board changed elsewhere' }),
    )
    expect(hub.board(id)).toEqual(elsewhere)
    await user.click(dialog.getByRole('button', { name: 'Keep editing' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(screen.getByRole('textbox', { name: 'Board name' })).toHaveValue('My own rename')
    expect(hub.board(id)).toEqual(elsewhere)
  })

  it('Reload discards the draft and shows the Hub copy', async () => {
    const hub = hubWithBoard()
    const user = userEvent.setup()
    openBoard(`/boards/${id}?edit=true`, hub.client)

    const name = await screen.findByRole('textbox', { name: 'Board name' })
    await user.clear(name)
    await user.type(name, 'My own rename')
    hub.saveElsewhere(id, elsewhere)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await user.click(await screen.findByRole('button', { name: 'Reload' }))

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Renamed by someone else' }),
    ).toBeVisible()
    expect(hub.board(id)).toEqual(elsewhere)
  })

  it('tells of a Board deleted elsewhere, and Reload goes to the Overview', async () => {
    const hub = hubWithBoard()
    const user = userEvent.setup()
    const { router } = openBoard(`/boards/${id}?edit=true`, hub.client)

    const name = await screen.findByRole('textbox', { name: 'Board name' })
    await user.type(name, '!')
    hub.deleteElsewhere(id)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/was deleted while you were editing/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Reload' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/boards/overview')
    })
  })
})

describe('deleting and leaving', () => {
  it('deletes the Board after asking, and lands on the Overview', async () => {
    const hub = hubWithBoard()
    const user = userEvent.setup()
    const { router } = openBoard(`/boards/${id}?edit=true`, hub.client)

    await user.click(await screen.findByRole('button', { name: 'Delete Board' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Delete this Board?' }))
    await user.click(dialog.getByRole('button', { name: 'Delete Board' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/boards/overview')
    })
    expect(hub.board(id)).toBeUndefined()
  })

  it('asks before leaving with unsaved changes, and Keep editing stays', async () => {
    const hub = hubWithBoard()
    const user = userEvent.setup()
    const { router } = openBoard(`/boards/${id}?edit=true`, hub.client)

    await user.type(await screen.findByRole('textbox', { name: 'Board name' }), '!')
    const nav = within(await screen.findByRole('navigation', { name: 'Board list' }))
    await user.click(await nav.findByRole('link', { name: 'Everything' }))

    const dialog = within(await screen.findByRole('dialog', { name: 'Discard your changes?' }))
    expect(router.state.location.pathname).toBe(`/boards/${id}`)
    await user.click(dialog.getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByRole('textbox', { name: 'Board name' })).toHaveValue('My spend!')

    await user.click(nav.getByRole('link', { name: 'Everything' }))
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Discard your changes?' })).getByRole(
        'button',
        { name: 'Discard changes' },
      ),
    )
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/boards/everything')
    })
  })

  it('does not ask when nothing changed', async () => {
    const hub = hubWithBoard()
    const user = userEvent.setup()
    const { router } = openBoard(`/boards/${id}?edit=true`, hub.client)

    const nav = within(await screen.findByRole('navigation', { name: 'Board list' }))
    await user.click(await nav.findByRole('link', { name: 'Everything' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/boards/everything')
    })
  })
})
