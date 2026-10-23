import { describe, expect, it } from 'vitest'

import { boardSchema } from '#features/boards/schemas/board'
import { newBoardPreset, overviewPreset } from '#features/boards/utils/presets'

import {
  addQueryItem,
  addSectionItem,
  addWidgetItem,
  removeBoardItem,
  setItemOverride,
  uniqueItemId,
  withLayout,
} from './editBoard'

const widget = { id: 'cost-today', size: { w: 3, h: 2 } }

describe('adding', () => {
  it('puts a Widget at its default size below everything else', () => {
    const { board, id } = addWidgetItem(newBoardPreset, widget)

    expect(id).toBe('cost-today')
    expect(board.items).toEqual([{ i: 'cost-today', type: 'widget', widget: 'cost-today' }])
    expect(board.layout).toEqual([{ i: 'cost-today', x: 0, y: 0, w: 3, h: 2 }])
    expect(newBoardPreset.items).toEqual([])
  })

  it('lets the same Widget in twice under different item ids', () => {
    const once = addWidgetItem(newBoardPreset, widget)
    const twice = addWidgetItem(once.board, widget)

    expect(twice.id).toBe('cost-today-2')
    expect(twice.board.items.map((item) => item.i)).toEqual(['cost-today', 'cost-today-2'])
    expect(boardSchema.safeParse(twice.board).success).toBe(true)
  })

  it('adds a Query Widget at its chart kind’s size, as a Board the schema accepts', () => {
    const query = {
      source: {
        kind: 'metric' as const,
        name: 'claude_code.cost.usage',
        aggregation: 'sum' as const,
      },
      groupBy: [],
      filter: [],
      chart: 'stat' as const,
    }
    const once = addQueryItem(newBoardPreset, 'Spend, in $', query, { w: 3, h: 2 })
    const twice = addQueryItem(once.board, 'Spend, in $', query, { w: 3, h: 2 })

    expect(once.id).toBe('query-spend-in')
    expect(twice.id).toBe('query-spend-in-2')
    expect(once.board.items).toEqual([{ i: once.id, type: 'query', title: 'Spend, in $', query }])
    expect(once.board.layout).toEqual([{ i: once.id, x: 0, y: 0, w: 3, h: 2 }])
    expect(boardSchema.safeParse(twice.board).success).toBe(true)
  })

  it('adds a section as a static full-width heading', () => {
    const { board, id } = addSectionItem(newBoardPreset, 'This week, in £')

    expect(id).toBe('section-this-week-in')
    expect(board.items).toEqual([{ i: id, type: 'section', title: 'This week, in £' }])
    expect(board.layout).toEqual([{ i: id, x: 0, y: 0, w: 12, h: 1, static: true }])
  })

  it('keeps an item id within the 64 characters a Board allows', () => {
    const id = uniqueItemId(newBoardPreset, 'x'.repeat(200))
    expect(id.length).toBeLessThanOrEqual(64)
  })

  it('yields a Board the schema accepts', () => {
    const { board } = addWidgetItem(addSectionItem(overviewPreset, 'More').board, widget)
    expect(boardSchema.safeParse(board).success).toBe(true)
  })
})

describe('removing', () => {
  it('takes the item and its cell, and closes the gap', () => {
    const { board: one } = addWidgetItem(newBoardPreset, widget)
    const { board: two, id } = addWidgetItem(one, { id: 'model-mix', size: { w: 4, h: 4 } })
    const removed = removeBoardItem(two, 'cost-today')

    expect(removed.items.map((item) => item.i)).toEqual([id])
    expect(removed.layout).toEqual([{ i: id, x: 0, y: 0, w: 4, h: 4 }])
  })
})

describe('the Layout from the grid', () => {
  it('keeps only what a Board stores', () => {
    const { board } = addWidgetItem(newBoardPreset, widget)
    const moved = withLayout(board, [{ i: 'cost-today', x: 4, y: 1, w: 5, h: 3, minW: 2 } as never])

    expect(moved.layout).toEqual([{ i: 'cost-today', x: 4, y: 1, w: 5, h: 3 }])
  })
})

describe('pinning', () => {
  const { board } = addWidgetItem(newBoardPreset, widget)

  it('pins filters on a Widget, and an empty override unpins it', () => {
    const pinned = setItemOverride(board, 'cost-today', { model: 'claude-opus-4-7' })
    expect(pinned.items[0]).toEqual({
      i: 'cost-today',
      type: 'widget',
      widget: 'cost-today',
      override: { model: 'claude-opus-4-7' },
    })

    const unpinned = setItemOverride(pinned, 'cost-today', { model: undefined })
    expect(unpinned.items[0]).toEqual({ i: 'cost-today', type: 'widget', widget: 'cost-today' })
    expect(setItemOverride(pinned, 'cost-today', undefined).items[0]).not.toHaveProperty('override')
  })

  it('leaves a section alone', () => {
    const { board: withSection, id } = addSectionItem(board, 'Head')
    expect(setItemOverride(withSection, id, { model: 'm' })).toEqual(withSection)
  })
})
