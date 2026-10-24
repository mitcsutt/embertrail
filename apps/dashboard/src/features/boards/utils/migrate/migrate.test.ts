import { describe, expect, it } from 'vitest'

import { overviewPreset } from '#features/boards/utils/presets'

import {
  boardMigrations,
  currentBoardVersion,
  doubleRows,
  InvalidBoardError,
  migrateBoard,
  UnsupportedBoardVersionError,
} from './migrate'
import type { BoardMigration } from './migrate'

// A made-up version 0, so the path exists before a real second version does: it called the name
// `title` and had no `schema_version` bump to make.
const v0 = (): Record<string, unknown> => {
  const { name, ...rest } = structuredClone(overviewPreset)
  return { ...rest, schema_version: 0, title: name }
}
const liftV0: BoardMigration = ({ title, ...rest }) => ({ ...rest, name: title })

describe('migrateBoard', () => {
  it('reads the current version as it is', () => {
    expect(migrateBoard(structuredClone(overviewPreset))).toEqual(overviewPreset)
    expect(currentBoardVersion).toBe(2)
  })

  it('lifts a synthetic v0 through its migration and the ones after it', () => {
    const keep: BoardMigration = (board) => board
    expect(migrateBoard(v0(), { 0: liftV0, 1: keep })).toEqual(overviewPreset)
  })

  it('refuses a version it has no migration for', () => {
    expect(() => migrateBoard(v0())).toThrow(InvalidBoardError)
    expect(() => migrateBoard(v0())).toThrow('no migration from schema_version 0')
  })

  it('refuses a newer version', () => {
    const error = (() => {
      try {
        migrateBoard({ ...structuredClone(overviewPreset), schema_version: 3 })
      } catch (thrown) {
        return thrown
      }
    })()
    expect(error).toBeInstanceOf(UnsupportedBoardVersionError)
    expect((error as UnsupportedBoardVersionError).version).toBe(3)
  })

  it.each([
    null,
    'board',
    [],
    {},
    { schema_version: '1' },
    { schema_version: -1 },
    { schema_version: 1.5 },
  ])('refuses %j', (stored) => {
    expect(() => migrateBoard(stored)).toThrow(InvalidBoardError)
  })

  it('names what is wrong with a current Board that does not parse', () => {
    const broken = { ...structuredClone(overviewPreset), name: '' }
    expect(() => migrateBoard(broken)).toThrow(/name:/)
  })
})

describe('version 1 to 2', () => {
  // Two sections, a row of two Widgets under the first and one tall Widget under the second, on
  // version 1's 6rem rows.
  const v1 = {
    schema_version: 1,
    name: 'Mine',
    filters: { time: { kind: 'relative', range: 'last-7-days' } },
    items: [
      { i: 'section-today', type: 'section', title: 'Today' },
      { i: 'cost-today', type: 'widget', widget: 'cost-today' },
      { i: 'model-mix', type: 'widget', widget: 'model-mix' },
      { i: 'section-period', type: 'section', title: 'Period' },
      { i: 'each-day-by-model', type: 'widget', widget: 'each-day-by-model' },
    ],
    layout: [
      { i: 'section-today', x: 0, y: 0, w: 12, h: 1, static: true },
      { i: 'cost-today', x: 0, y: 1, w: 3, h: 2 },
      { i: 'model-mix', x: 3, y: 1, w: 4, h: 4 },
      { i: 'section-period', x: 0, y: 5, w: 12, h: 1, static: true },
      { i: 'each-day-by-model', x: 0, y: 6, w: 12, h: 4 },
    ],
  }

  it('doubles every height but a section, and closes the rows the sections gave back', () => {
    const board = migrateBoard(structuredClone(v1))
    expect(board.schema_version).toBe(2)
    expect(board.items).toEqual(v1.items)
    expect(board.layout).toEqual([
      { i: 'section-today', x: 0, y: 0, w: 12, h: 1, static: true },
      { i: 'cost-today', x: 0, y: 1, w: 3, h: 4 },
      { i: 'model-mix', x: 3, y: 1, w: 4, h: 8 },
      { i: 'section-period', x: 0, y: 9, w: 12, h: 1, static: true },
      { i: 'each-day-by-model', x: 0, y: 10, w: 12, h: 8 },
    ])
  })

  it('is the migration registered for version 1', () => {
    expect(boardMigrations[1]).toBe(doubleRows)
  })

  it('leaves a Layout that is not one for the schema to refuse', () => {
    const broken = { ...structuredClone(v1), layout: [{ i: 'cost-today', x: 'left' }] }
    expect(doubleRows(broken)).toBe(broken)
    expect(() => migrateBoard(broken)).toThrow(InvalidBoardError)
  })
})
