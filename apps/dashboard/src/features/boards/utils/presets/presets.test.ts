import { describe, expect, it } from 'vitest'

import { boardSchema } from '#features/boards/schemas/board'
import type { BoardDocument } from '#features/boards/types/board'
import { presetIds } from '#features/boards/types/board'
import type { WidgetGroup, WidgetKind } from '#features/widgets/types/widget'

import {
  customisePreset,
  everythingPreset,
  isPresetId,
  newBoardPreset,
  overviewPreset,
  presetBoard,
} from './presets'
import type { PresetWidget } from './presets'

/** The Catalogue's Widgets at their default sizes, in its order (the KPIs open their groups). */
const catalogue: PresetWidget[] = (
  [
    ['spend', 'period-cost', 'stat', 2, 3],
    ['spend', 'cost-today', 'stat', 3, 2],
    ['spend', 'cost-this-week', 'stat', 3, 2],
    ['spend', 'each-day-by-model', 'bars', 8, 6],
    ['spend', 'cost-by-account', 'bars', 4, 6],
    ['sessions', 'period-sessions', 'stat', 2, 3],
    ['sessions', 'sessions-today', 'stat', 3, 2],
    ['sessions', 'top-sessions', 'table', 7, 6],
    ['sessions', 'sessions-per-day', 'bars', 5, 6],
    ['models', 'period-tokens', 'stat', 2, 3],
    ['models', 'model-mix', 'share', 4, 6],
    ['models', 'cache-share', 'stat', 3, 2],
    ['models', 'tokens-by-type', 'series', 8, 6],
    ['tools', 'top-tools', 'bar-list', 4, 6],
    ['tools', 'tool-failures', 'table', 4, 6],
    ['tools', 'edit-acceptance', 'share', 4, 6],
    ['output', 'period-lines-changed', 'stat', 2, 3],
    ['output', 'period-commits', 'stat', 2, 3],
    ['output', 'lines-changed-per-day', 'bars', 6, 6],
    ['output', 'commits-per-day', 'bars', 6, 6],
    ['rhythm', 'period-active-time', 'stat', 2, 3],
    ['rhythm', 'today-by-hour-vs-typical', 'series', 7, 6],
    ['rhythm', 'when-you-work', 'heatmap', 5, 7],
    ['rhythm', 'active-time-per-day', 'bars', 7, 6],
    ['reliability', 'api-errors', 'bars', 6, 6],
    ['reliability', 'request-latency', 'series', 6, 6],
  ] as [WidgetGroup, string, WidgetKind, number, number][]
).map(([group, id, kind, w, h]) => ({ id, group, kind, size: { w, h } }))

/** The columns each row of Widgets fills, by the row it starts on. */
const rowWidths = (board: BoardDocument): number[] => {
  const widths = new Map<number, number>()
  for (const cell of board.layout) widths.set(cell.y, (widths.get(cell.y) ?? 0) + cell.w)
  return [...widths.values()]
}

const placement = (board: BoardDocument, id: string): string => {
  const cell = board.layout.find((entry) => entry.i === id)
  return cell === undefined
    ? 'missing'
    : `${String(cell.x)},${String(cell.y)} ${String(cell.w)}x${String(cell.h)}`
}

const overlaps = (board: BoardDocument): string[] => {
  const found: string[] = []
  board.layout.forEach((a, index) => {
    for (const b of board.layout.slice(index + 1)) {
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
        found.push(`${a.i} / ${b.i}`)
      }
    }
  })
  return found
}

describe.each([
  ['Overview', overviewPreset],
  ['Everything', everythingPreset(catalogue)],
  ['New Board', newBoardPreset],
])('the %s Preset', (_name, preset) => {
  it('is a valid Board', () => {
    expect(boardSchema.parse(preset)).toEqual(preset)
  })

  it('has no Widgets drawn over each other', () => {
    expect(overlaps(preset)).toEqual([])
  })

  it('is frozen, so it cannot be edited in place', () => {
    expect(Object.isFrozen(preset)).toBe(true)
    expect(Object.isFrozen(preset.items)).toBe(true)
  })

  it('starts on the last 7 days', () => {
    expect(preset.filters).toEqual({ time: { kind: 'relative', range: 'last-7-days' } })
  })
})

describe('Overview', () => {
  it('opens on six KPIs, then the cost by day, where it went and the rhythm', () => {
    expect(overviewPreset.items.map((item) => item.i)).toEqual([
      'period-cost',
      'period-sessions',
      'period-tokens',
      'period-active-time',
      'period-lines-changed',
      'period-commits',
      'each-day-by-model',
      'model-mix',
      'top-sessions',
      'top-tools',
      'today-by-hour-vs-typical',
      'when-you-work',
    ])
    expect(overviewPreset.items.every((item) => item.type === 'widget')).toBe(true)
  })

  it('holds only Widgets the Catalogue has', () => {
    const known = new Set(catalogue.map(({ id }) => id))
    expect(overviewPreset.items.filter((item) => !known.has(item.i))).toEqual([])
  })

  it('puts the KPIs and the cost by day in the first nine rows, every row full', () => {
    expect(placement(overviewPreset, 'period-cost')).toBe('0,0 2x3')
    expect(placement(overviewPreset, 'period-commits')).toBe('10,0 2x3')
    expect(placement(overviewPreset, 'each-day-by-model')).toBe('0,3 8x6')
    expect(placement(overviewPreset, 'model-mix')).toBe('8,3 4x6')
    expect(placement(overviewPreset, 'top-sessions')).toBe('0,9 7x6')
    expect(placement(overviewPreset, 'when-you-work')).toBe('6,15 6x6')
    expect(rowWidths(overviewPreset)).toEqual([12, 12, 12, 12])
  })
})

describe('Everything', () => {
  const everything = everythingPreset(catalogue)

  it('has one section per group, in Catalogue order, and every Widget once', () => {
    const sections = everything.items.filter((item) => item.type === 'section')
    expect(sections.map((section) => section.title)).toEqual([
      'Spend',
      'Sessions',
      'Models',
      'Tools',
      'Output',
      'Rhythm',
      'Reliability',
    ])
    const widgets = everything.items.flatMap((item) =>
      item.type === 'widget' ? [item.widget] : [],
    )
    expect(widgets.toSorted()).toEqual(catalogue.map((widget) => widget.id).toSorted())
  })

  it('puts a group’s stats in a row of their own, above its charts', () => {
    const row = (id: string) => everything.layout.find((cell) => cell.i === id)?.y
    expect(row('period-tokens')).toBe(row('cache-share'))
    expect(row('model-mix')).toBe(row('tokens-by-type'))
    expect(row('model-mix')).toBeGreaterThan(row('cache-share') ?? Infinity)
  })

  it('fills every row to the full width, each Widget as tall as its row', () => {
    expect(placement(everything, 'period-cost')).toBe('0,1 3x3')
    expect(placement(everything, 'cost-today')).toBe('3,1 5x3')
    expect(placement(everything, 'cost-this-week')).toBe('8,1 4x3')
    expect(placement(everything, 'each-day-by-model')).toBe('0,4 8x6')
    expect(placement(everything, 'cost-by-account')).toBe('8,4 4x6')
    expect(rowWidths(everything).every((width) => width === 12)).toBe(true)
  })

  it('follows the Catalogue it is given', () => {
    const added = everythingPreset([
      ...catalogue,
      { id: 'extra', group: 'tools', kind: 'stat', size: { w: 2, h: 2 } },
    ])
    expect(added.items.map((item) => item.i)).toContain('extra')
  })
})

describe('presetBoard and isPresetId', () => {
  it('resolves each reserved id', () => {
    expect(presetBoard('overview', catalogue)).toBe(overviewPreset)
    expect(presetBoard('new', catalogue)).toBe(newBoardPreset)
    expect(presetBoard('everything', catalogue).name).toBe('Everything')
  })

  it('recognises the reserved ids and no stored Board id', () => {
    expect(presetIds.every((id) => isPresetId(id))).toBe(true)
    expect(isPresetId('b-abcde12345')).toBe(false)
  })
})

describe('customisePreset', () => {
  it('copies the Preset under a new name and leaves the Preset as it was', () => {
    const before = structuredClone(overviewPreset)
    const copy = customisePreset(overviewPreset)
    expect(copy.name).toBe('Overview (copy)')
    expect({ ...copy, name: 'Overview' }).toEqual(before)
    copy.items.push({ i: 'x', type: 'section', title: 'x' })
    copy.layout[0] = { i: 'period-cost', x: 0, y: 5, w: 12, h: 1 }
    expect(overviewPreset).toEqual(before)
  })

  it('keeps the name of the empty Preset, which already names a new Board', () => {
    expect(customisePreset(newBoardPreset).name).toBe('New Board')
  })
})
