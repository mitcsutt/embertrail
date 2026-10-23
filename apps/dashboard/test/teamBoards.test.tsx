// Team Boards against an in-memory Hub (`fakeHub`): a solo User is shown nothing about Teams, a
// Team's editor creates, edits and deletes the Team's Boards as the Team, and a member who is not
// an editor reads them and can only copy them into their own.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it } from 'vitest'

import { boardSchema } from '#features/boards/schemas/board'
import type { BoardDocument } from '#features/boards/types/board'

import { fakeHub } from './fakeHub.ts'
import { openBoard } from './openBoard.tsx'

// Radix Select and Popover use pointer capture and scrolling, which jsdom lacks.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => undefined
  Element.prototype.releasePointerCapture = () => undefined
})

const board = (name: string): BoardDocument => ({
  schema_version: 1,
  name,
  filters: { time: { kind: 'relative', range: 'last-7-days' } },
  items: [{ i: 'a', type: 'widget', widget: 'cost-today' }],
  layout: [{ i: 'a', x: 0, y: 0, w: 3, h: 2 }],
})

const mine = 'b-mine000001'
const shared = 'b-shared00001'
const boards = { [mine]: board('Private spend'), [shared]: board('Crew spend') }
const owners = { [shared]: { kind: 'team' as const, id: 'crew' } }
const editorOf = [{ id: 'crew', name: 'Crew', editor: true }]
const memberOf = [{ id: 'crew', name: 'Crew', editor: false }]

const puts = (hub: ReturnType<typeof fakeHub>) =>
  hub.requests.filter(({ line }) => line.startsWith('PUT '))

describe('a solo User', () => {
  const noTeamText = () => {
    expect(document.body.textContent).not.toMatch(/team/i)
    expect(screen.queryByRole('combobox', { name: 'Owner' })).not.toBeInTheDocument()
  }

  it('sees no Team control or word on a Preset, a Board, the Board list or New Board', async () => {
    const hub = fakeHub({ boards })
    const user = userEvent.setup()
    openBoard('/boards/overview', hub.client)

    expect(await screen.findByRole('button', { name: 'Customise' })).toBeVisible()
    expect(await screen.findByRole('link', { name: 'Private spend' })).toBeVisible()
    noTeamText()
    expect(screen.queryByText('Yours')).not.toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'New Board' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'New Board' })).toBeVisible()
    noTeamText()

    await user.click(screen.getByRole('link', { name: 'Private spend' }))
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeVisible()
    noTeamText()
  })

  it('sees none in edit mode, and writes without an Embertrail-Owner', async () => {
    const hub = fakeHub({ boards })
    const user = userEvent.setup()
    openBoard(`/boards/${mine}?edit=true`, hub.client)

    expect(await screen.findByRole('heading', { level: 1, name: 'Edit Board' })).toBeVisible()
    noTeamText()
    await user.type(screen.getByRole('textbox', { name: 'Board name' }), '!')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(puts(hub)).toHaveLength(1)
    })
    expect(puts(hub)[0]?.owner).toBeUndefined()
  })
})

describe('a Team editor', () => {
  it('lists the Boards under Yours and under each Team', async () => {
    const hub = fakeHub({ boards, owners, teams: editorOf })
    openBoard('/boards/overview', hub.client)

    const nav = within(await screen.findByRole('navigation', { name: 'Yours' }))
    expect(nav.getByRole('link', { name: 'Private spend' })).toBeVisible()
    expect(nav.queryByRole('link', { name: 'Crew spend' })).not.toBeInTheDocument()
    const crew = within(await screen.findByRole('navigation', { name: 'Crew' }))
    expect(crew.getByRole('link', { name: 'Crew spend' })).toBeVisible()
    expect(screen.getByText('Crew', { selector: 'p, span, div' })).toBeVisible()
  })

  it('creates a Team Board from New Board by choosing the Team as Owner', async () => {
    const hub = fakeHub({ teams: editorOf })
    const user = userEvent.setup()
    const { router } = openBoard('/boards/new', hub.client)

    await user.click(await screen.findByRole('combobox', { name: 'Owner' }))
    await user.click(await screen.findByRole('option', { name: 'Crew (Team)' }))
    await user.click(screen.getByRole('button', { name: 'Customise' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Edit Board' })).toBeVisible()
    expect(screen.getByText('Owned by Crew')).toBeVisible()
    expect(puts(hub)).toHaveLength(1)
    expect(puts(hub)[0]?.owner).toBe('team:crew')
    const id = router.state.location.pathname.split('/').at(-1) ?? ''
    expect(hub.ownerOf(id)).toEqual({ kind: 'team', id: 'crew' })
  })

  it('creates their own Board when the Owner is left as Yours', async () => {
    const hub = fakeHub({ teams: editorOf })
    const user = userEvent.setup()
    openBoard('/boards/overview', hub.client)

    await user.click(await screen.findByRole('button', { name: 'Customise' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Edit Board' })).toBeVisible()
    expect(puts(hub)[0]?.owner).toBeUndefined()
    expect(screen.queryByText(/Owned by/)).not.toBeInTheDocument()
  })

  it('saves and deletes a Team Board as the Team', async () => {
    const hub = fakeHub({ boards, owners, teams: editorOf })
    const user = userEvent.setup()
    openBoard(`/boards/${shared}`, hub.client)

    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    await user.type(await screen.findByRole('textbox', { name: 'Board name' }), '!')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(puts(hub)).toHaveLength(1)
    })
    expect(puts(hub)[0]?.owner).toBe('team:crew')
    expect(boardSchema.parse(hub.board(shared)).name).toBe('Crew spend!')
    expect(hub.ownerOf(shared)).toEqual({ kind: 'team', id: 'crew' })

    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    await user.click(await screen.findByRole('button', { name: 'Delete Board' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Delete this Board?' }))
    await user.click(dialog.getByRole('button', { name: 'Delete Board' }))
    await waitFor(() => {
      expect(hub.board(shared)).toBeUndefined()
    })
    const deletes = hub.requests.filter(({ line }) => line.startsWith('DELETE '))
    expect(deletes.map(({ owner }) => owner)).toEqual(['team:crew'])
  })

  it('sends the Embertrail-Owner on writes only', async () => {
    const hub = fakeHub({ boards, owners, teams: editorOf })
    const user = userEvent.setup()
    openBoard(`/boards/${shared}`, hub.client)
    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    await user.type(await screen.findByRole('textbox', { name: 'Board name' }), '!')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(puts(hub)).toHaveLength(1)
    })

    const withOwner = hub.requests.filter(({ owner }) => owner !== undefined)
    expect(withOwner.map(({ line }) => line.split(' ')[0])).toEqual(['PUT'])
  })
})

describe('a Team member who is not an editor', () => {
  it('reads a Team Board, which they cannot edit, and offers Customise instead', async () => {
    const hub = fakeHub({ boards, owners, teams: memberOf })
    openBoard(`/boards/${shared}?edit=true`, hub.client)

    expect(await screen.findByRole('heading', { level: 1, name: 'Crew spend' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Edit Board' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(screen.getByText(/Crew owns this Board and you cannot edit it/)).toBeVisible()
    expect(screen.queryByRole('combobox', { name: 'Owner' })).not.toBeInTheDocument()
  })

  it('copies a Team Board into their own Boards with Customise', async () => {
    const hub = fakeHub({ boards, owners, teams: memberOf })
    const user = userEvent.setup()
    const { router } = openBoard(`/boards/${shared}`, hub.client)

    await user.click(await screen.findByRole('button', { name: 'Customise' }))

    expect(await screen.findByRole('textbox', { name: 'Board name' })).toHaveValue(
      'Crew spend (copy)',
    )
    expect(puts(hub)).toHaveLength(1)
    expect(puts(hub)[0]?.owner).toBeUndefined()
    const id = router.state.location.pathname.split('/').at(-1) ?? ''
    expect(hub.ownerOf(id)?.kind).toBe('user')
    expect(boardSchema.parse(hub.board(shared)).name).toBe('Crew spend')
  })

  it('has no Owner choice on a Preset, having no Team to edit', async () => {
    const hub = fakeHub({ teams: memberOf })
    openBoard('/boards/overview', hub.client)

    expect(await screen.findByRole('button', { name: 'Customise' })).toBeVisible()
    expect(screen.queryByRole('combobox', { name: 'Owner' })).not.toBeInTheDocument()
  })
})
