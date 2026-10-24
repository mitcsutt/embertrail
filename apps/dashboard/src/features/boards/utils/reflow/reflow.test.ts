import { describe, expect, it } from 'vitest'

import { overviewPreset } from '#features/boards/utils/presets'

import { fillRow, reflowLayout } from './reflow'

describe('fillRow', () => {
  it('grows each width in proportion to fill twelve columns', () => {
    const row = fillRow([
      { id: 'a', w: 2, h: 3 },
      { id: 'b', w: 3, h: 2 },
      { id: 'c', w: 3, h: 2 },
    ])
    expect(row.map(({ w }) => w)).toEqual([3, 5, 4])
    expect(row.map(({ h }) => h)).toEqual([3, 3, 3])
  })

  it('leaves a full row as it is', () => {
    const row = [
      { id: 'a', w: 8, h: 6 },
      { id: 'b', w: 4, h: 6 },
    ]
    expect(fillRow(row)).toEqual(row)
  })

  it('widens a Widget alone in its row to the full width', () => {
    expect(fillRow([{ id: 'a', w: 7, h: 6 }])).toEqual([{ id: 'a', w: 12, h: 6 }])
  })
})

describe('reflowLayout', () => {
  const at = (columns: number, id: string) => {
    const cell = reflowLayout(overviewPreset.layout, columns).find((entry) => entry.i === id)
    return cell === undefined
      ? 'missing'
      : `${String(cell.x)},${String(cell.y)} ${String(cell.w)}x${String(cell.h)}`
  }

  it('leaves the 12-column Layout as it is', () => {
    expect(reflowLayout(overviewPreset.layout, 12)).toEqual(overviewPreset.layout)
  })

  it('sets the KPIs two to a row on four columns, and everything else across the row', () => {
    expect(at(4, 'period-cost')).toBe('0,0 2x3')
    expect(at(4, 'period-sessions')).toBe('2,0 2x3')
    expect(at(4, 'period-tokens')).toBe('0,3 2x3')
    expect(at(4, 'period-commits')).toBe('2,6 2x3')
    expect(at(4, 'each-day-by-model')).toBe('0,9 4x6')
    expect(at(4, 'model-mix')).toBe('0,15 4x6')
  })

  it('keeps pairs side by side on eight columns', () => {
    expect(at(8, 'period-cost')).toBe('0,0 2x3')
    expect(at(8, 'period-lines-changed')).toBe('0,3 4x3')
    expect(at(8, 'each-day-by-model')).toBe('0,6 5x6')
    expect(at(8, 'model-mix')).toBe('5,6 3x6')
  })

  it('places every cell once, with nothing drawn over another', () => {
    for (const columns of [4, 8]) {
      const layout = reflowLayout(overviewPreset.layout, columns)
      expect(layout.map(({ i }) => i).toSorted()).toEqual(
        overviewPreset.layout.map(({ i }) => i).toSorted(),
      )
      expect(layout.every(({ x, w }) => x + w <= columns)).toBe(true)
      layout.forEach((a, index) => {
        for (const b of layout.slice(index + 1)) {
          expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).toBe(
            false,
          )
        }
      })
    }
  })
})
