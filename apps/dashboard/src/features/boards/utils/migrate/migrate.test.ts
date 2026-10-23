import { describe, expect, it } from 'vitest'

import { overviewPreset } from '#features/boards/utils/presets'

import {
  currentBoardVersion,
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
    expect(currentBoardVersion).toBe(1)
  })

  it('lifts a synthetic v0 through its migration', () => {
    expect(migrateBoard(v0(), { 0: liftV0 })).toEqual(overviewPreset)
  })

  it('refuses a version it has no migration for', () => {
    expect(() => migrateBoard(v0())).toThrow(InvalidBoardError)
    expect(() => migrateBoard(v0())).toThrow('no migration from schema_version 0')
  })

  it('refuses a newer version', () => {
    const error = (() => {
      try {
        migrateBoard({ ...structuredClone(overviewPreset), schema_version: 2 })
      } catch (thrown) {
        return thrown
      }
    })()
    expect(error).toBeInstanceOf(UnsupportedBoardVersionError)
    expect((error as UnsupportedBoardVersionError).version).toBe(2)
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
