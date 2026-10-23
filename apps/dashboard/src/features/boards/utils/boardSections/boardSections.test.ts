import { describe, expect, it } from 'vitest'

import type { BoardSummary } from '#features/boards/data/boards'

import { boardSections } from './boardSections'

const board = (id: string, owner: BoardSummary['owner']): BoardSummary => ({
  id,
  name: id,
  owner,
  updatedAt: '2026-11-01T00:00:00Z',
})

const mine = board('mine', { kind: 'user', id: 'u1' })
const crew = board('crew-1', { kind: 'team', id: 'crew' })
const guild = board('guild-1', { kind: 'team', id: 'guild' })

describe('boardSections', () => {
  it('gives a solo User one list without a heading', () => {
    expect(boardSections([mine], [])).toEqual([
      { key: 'user', label: 'Boards', heading: false, boards: [mine] },
    ])
    expect(boardSections([], [])).toEqual([
      { key: 'user', label: 'Boards', heading: false, boards: [] },
    ])
  })

  it('groups a Team member’s Boards by Owner, Yours first and the Teams in their order', () => {
    const teams = [
      { id: 'guild', name: 'Guild', editor: false },
      { id: 'crew', name: 'Crew', editor: true },
    ]
    expect(boardSections([crew, mine, guild], teams)).toEqual([
      { key: 'user', label: 'Yours', heading: true, boards: [mine] },
      { key: 'team:guild', label: 'Guild', heading: true, boards: [guild] },
      { key: 'team:crew', label: 'Crew', heading: true, boards: [crew] },
    ])
  })

  it('leaves out a section with no Board, and names a Team the caller no longer lists by its id', () => {
    const teams = [{ id: 'crew', name: 'Crew', editor: true }]
    expect(boardSections([guild], teams)).toEqual([
      { key: 'team:guild', label: 'guild', heading: true, boards: [guild] },
    ])
  })
})
