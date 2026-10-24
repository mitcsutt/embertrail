import { Ajv2020 } from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'

import type { BoardDocument } from '#features/boards/types/board'
import { everythingPreset, newBoardPreset, overviewPreset } from '#features/boards/utils/presets'
import type { PresetWidget } from '#features/boards/utils/presets'

import { boardJsonSchema, boardSchema } from './board'

const ajv = new Ajv2020({ strict: false, allErrors: true })
ajv.addFormat('date-time', true)
const validates = ajv.compile(boardJsonSchema())

const board = (change: (draft: BoardDocument) => void): unknown => {
  const draft = structuredClone(overviewPreset)
  change(draft)
  return draft
}

const widgets: PresetWidget[] = [
  { id: 'cost-today', group: 'spend', kind: 'stat', size: { w: 3, h: 2 } },
  { id: 'top-tools', group: 'tools', kind: 'bar-list', size: { w: 4, h: 6 } },
]

describe('the committed JSON Schema', () => {
  it('is the one the zod schema describes', async () => {
    // Run `pnpm test -- -u` after changing boardStructure to rewrite the file.
    await expect(`${JSON.stringify(boardJsonSchema(), null, 2)}\n`).toMatchFileSnapshot(
      './board.schema.json',
    )
  })

  it('is draft 2020-12', () => {
    expect(boardJsonSchema()).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
    })
  })
})

describe.each([
  ['the JSON Schema', (value: unknown) => validates(value)],
  ['the zod schema', (value: unknown) => boardSchema.safeParse(value).success],
])('%s', (_name, accepts) => {
  it.each([
    ['Overview', overviewPreset],
    ['Everything', everythingPreset(widgets)],
    ['New Board', newBoardPreset],
  ])('accepts the %s Preset', (_preset, preset) => {
    expect(accepts(preset)).toBe(true)
  })

  it('accepts a Board with pinned overrides, a Query Widget and an absolute range', () => {
    const custom = board((draft) => {
      draft.filters = {
        time: { kind: 'absolute', from: '2026-10-01', to: '2026-11-01' },
        model: 'm',
      }
      draft.items.push({
        i: 'q1',
        type: 'query',
        title: 'Reads',
        override: { sourceId: 's' },
        query: {
          source: {
            kind: 'event',
            name: 'tool_result',
            aggregation: { fn: 'p95', key: 'duration_ms' },
          },
          groupBy: ['tool_name'],
          bucket: 'hour',
          filter: [
            { key: 'success', op: 'eq', value: true },
            { key: 'model', op: 'in', value: ['a', 'b'] },
            { key: 'error', op: 'not_exists' },
          ],
          chart: 'series',
          limit: 50,
        },
      })
      draft.layout.push({ i: 'q1', x: 0, y: 99, w: 6, h: 4 })
    })
    expect(accepts(custom)).toBe(true)
  })

  it.each([
    ['another schema_version', board((draft) => void Object.assign(draft, { schema_version: 1 }))],
    ['no name', board((draft) => void Object.assign(draft, { name: '' }))],
    ['an unknown field', board((draft) => void Object.assign(draft, { extra: 1 }))],
    [
      'an unknown relative range',
      board((draft) => {
        draft.filters = { time: { kind: 'relative', range: 'last-year' as never } }
      }),
    ],
    [
      'a zero-width cell',
      board((draft) => {
        const cell = draft.layout[1]
        if (cell) cell.w = 0
      }),
    ],
    [
      'a fractional cell',
      board((draft) => {
        const cell = draft.layout[1]
        if (cell) cell.x = 0.5
      }),
    ],
    [
      'a cell past column 12 by x',
      board((draft) => {
        const cell = draft.layout[1]
        if (cell) cell.x = 12
      }),
    ],
    [
      'an unknown item type',
      board((draft) => {
        draft.items.push({ i: 'z', type: 'gauge' } as never)
      }),
    ],
    [
      'more than three group_by',
      board((draft) => {
        draft.items.push({
          i: 'q',
          type: 'query',
          title: 't',
          query: {
            source: { kind: 'metric', name: 'm', aggregation: 'sum' },
            groupBy: ['a', 'b', 'c', 'd'],
            filter: [],
            chart: 'bars',
          },
        })
      }),
    ],
    ['not an object', null],
  ])('rejects %s', (_what, value) => {
    expect(accepts(value)).toBe(false)
  })
})

describe('what only the zod schema checks', () => {
  const issues = (value: unknown): string[] => {
    const parsed = boardSchema.safeParse(value)
    return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message)
  }

  it('rejects a duplicate item id', () => {
    expect(
      issues(
        board((draft) => {
          const first = draft.items[0]
          if (first) draft.items.push(first)
        }),
      ),
    ).toContain(`Duplicate item id period-cost`)
  })

  it('rejects a Layout that names no item, places one twice, or leaves one out', () => {
    expect(
      issues(
        board((draft) => {
          draft.layout.push({ i: 'ghost', x: 0, y: 0, w: 1, h: 1 })
        }),
      ),
    ).toContain('No item ghost')
    expect(
      issues(
        board((draft) => {
          const cell = draft.layout[1]
          if (cell) draft.layout.push(cell)
        }),
      ),
    ).toContain('Placed twice: period-sessions')
    expect(
      issues(
        board((draft) => {
          draft.layout.pop()
        }),
      ),
    ).toContain('Item when-you-work has no place in the Layout')
  })

  it('rejects a cell that runs past column 12', () => {
    expect(
      issues(
        board((draft) => {
          const cell = draft.layout[1]
          if (cell) cell.x = 11
        }),
      ),
    ).toContain('Runs past column 12')
  })
})

describe('absolute ranges', () => {
  const absolute = (from: string, to: string) =>
    boardSchema.safeParse(
      board((draft) => {
        draft.filters = { time: { kind: 'absolute', from, to } }
      }),
    )

  it('are calendar dates, as the filters resolve them', () => {
    expect(absolute('2026-10-01', '2026-10-31').success).toBe(true)
    expect(absolute('2026-10-01', '2026-10-01').success).toBe(true)
  })

  it.each([
    ['an instant', '2026-10-01T00:00:00Z', '2026-10-31'],
    ['a date that does not exist', '2026-02-30', '2026-03-01'],
    ['a range that ends before it starts', '2026-10-31', '2026-10-01'],
  ])('refuse %s', (_what, from, to) => {
    expect(absolute(from, to).success).toBe(false)
  })
})
