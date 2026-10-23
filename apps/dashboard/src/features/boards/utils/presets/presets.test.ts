import { describe, expect, it } from 'vitest'

import { boardSchema } from '#features/boards/schemas/board'
import type { BoardDocument } from '#features/boards/types/board'
import { presetIds } from '#features/boards/types/board'
import type { WidgetGroup } from '#features/widgets/types/widget'

import {
  customisePreset,
  everythingPreset,
  isPresetId,
  newBoardPreset,
  overviewPreset,
  presetBoard,
} from './presets'
import type { PresetWidget } from './presets'

/** The 20 curated Widgets of #16, standing in for the Catalogue until its registry lands. */
const catalogue: PresetWidget[] = (
  [
    ['spend', 'cost-today', 3, 2],
    ['spend', 'cost-this-week', 3, 2],
    ['spend', 'each-day-by-model', 12, 4],
    ['spend', 'cost-by-account', 6, 4],
    ['sessions', 'sessions-today', 3, 2],
    ['sessions', 'top-sessions', 7, 5],
    ['sessions', 'sessions-per-day', 6, 4],
    ['models', 'model-mix', 4, 4],
    ['models', 'cache-share', 3, 2],
    ['models', 'tokens-by-type', 6, 4],
    ['tools', 'top-tools', 6, 4],
    ['tools', 'tool-failures', 6, 4],
    ['tools', 'edit-acceptance', 4, 4],
    ['output', 'lines-changed-per-day', 6, 4],
    ['output', 'commits-per-day', 6, 4],
    ['rhythm', 'today-by-hour-vs-typical', 8, 4],
    ['rhythm', 'when-you-work', 5, 5],
    ['rhythm', 'active-time-per-day', 6, 4],
    ['reliability', 'api-errors', 6, 4],
    ['reliability', 'request-latency', 6, 4],
  ] as [WidgetGroup, string, number, number][]
).map(([group, id, w, h]) => ({ id, group, size: { w, h } }))

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
  it('follows #16: four sections of nine Widgets at their widths', () => {
    expect(
      overviewPreset.items.map((item) => (item.type === 'section' ? `# ${item.title}` : item.i)),
    ).toEqual([
      '# Today at a glance',
      'cost-today',
      'cost-this-week',
      'sessions-today',
      'cache-share',
      '# Today',
      'today-by-hour-vs-typical',
      'model-mix',
      '# This period',
      'each-day-by-model',
      '# Patterns',
      'top-sessions',
      'when-you-work',
    ])
    const widths = Object.fromEntries(overviewPreset.layout.map(({ i, w }) => [i, w]))
    expect(widths).toMatchObject({
      'cost-today': 3,
      'cost-this-week': 3,
      'sessions-today': 3,
      'cache-share': 3,
      'today-by-hour-vs-typical': 8,
      'model-mix': 4,
      'each-day-by-model': 12,
      'top-sessions': 7,
      'when-you-work': 5,
    })
  })

  it('sets each row beneath the last and each heading static across the width', () => {
    expect(placement(overviewPreset, 'section-today-at-a-glance')).toBe('0,0 12x1')
    expect(placement(overviewPreset, 'cache-share')).toBe('9,1 3x2')
    expect(placement(overviewPreset, 'section-today')).toBe('0,3 12x1')
    expect(placement(overviewPreset, 'model-mix')).toBe('8,4 4x4')
    expect(placement(overviewPreset, 'when-you-work')).toBe('7,14 5x5')
    expect(overviewPreset.layout.filter((cell) => cell.static)).toHaveLength(4)
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
    expect(widgets).toEqual(catalogue.map((widget) => widget.id))
  })

  it('places each Widget at its default size, wrapping at column 12', () => {
    expect(placement(everything, 'cost-today')).toBe('0,1 3x2')
    expect(placement(everything, 'cost-this-week')).toBe('3,1 3x2')
    expect(placement(everything, 'each-day-by-model')).toBe('0,3 12x4')
    expect(placement(everything, 'cost-by-account')).toBe('0,7 6x4')
  })

  it('follows the Catalogue it is given', () => {
    const [first] = catalogue
    const added = everythingPreset([
      ...catalogue,
      { id: 'extra', group: 'tools', size: { w: 2, h: 2 } },
    ])
    expect(first).toBeDefined()
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
    copy.layout[0] = { i: 'section-today-at-a-glance', x: 0, y: 5, w: 12, h: 1 }
    expect(overviewPreset).toEqual(before)
  })
})
