import { z } from 'zod'

import type { BoardDocument } from '#features/boards/types/board'

const scalar = z.union([z.string(), z.number(), z.boolean()])
const dimension = z.string().min(1).max(200)

const filter = z.union([
  z.strictObject({
    key: dimension,
    op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte']),
    value: scalar,
  }),
  z.strictObject({
    key: dimension,
    op: z.enum(['in', 'not_in']),
    value: z.array(scalar).min(1).max(100),
  }),
  z.strictObject({ key: dimension, op: z.enum(['exists', 'not_exists']) }),
])

const instant = z.iso.datetime({ offset: true })

const timeRange = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('relative'),
    range: z.enum([
      'today',
      'yesterday',
      'this-week',
      'last-7-days',
      'last-30-days',
      'last-90-days',
    ]),
  }),
  z.strictObject({ kind: z.literal('absolute'), from: instant, to: instant }),
])

const filterId = z.string().min(1).max(200)

const filters = z.strictObject({
  time: timeRange,
  sourceId: filterId.optional(),
  accountId: filterId.optional(),
  model: filterId.optional(),
})

const override = filters.partial()

const widgetKind = z.enum(['stat', 'series', 'bars', 'bar-list', 'share', 'table', 'heatmap'])

const queryWidgetConfig = z.strictObject({
  source: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('metric'),
      name: z.string().min(1).max(200),
      aggregation: z.enum(['sum', 'avg', 'min', 'max', 'count', 'last']),
    }),
    z.strictObject({
      kind: z.literal('event'),
      name: z.string().min(1).max(200),
      aggregation: z.strictObject({ fn: z.string().min(1), key: z.string().min(1).optional() }),
    }),
  ]),
  groupBy: z.array(dimension).max(3),
  bucket: z.enum(['minute', 'hour', 'day', 'week', 'month']).optional(),
  filter: z.array(filter).max(50),
  chart: widgetKind,
  limit: z.int().min(1).optional(),
})

const itemId = z.string().min(1).max(64)

const item = z.discriminatedUnion('type', [
  z.strictObject({
    i: itemId,
    type: z.literal('widget'),
    widget: z.string().min(1).max(100),
    override: override.optional(),
  }),
  z.strictObject({
    i: itemId,
    type: z.literal('query'),
    title: z.string().min(1).max(200),
    query: queryWidgetConfig,
    override: override.optional(),
  }),
  z.strictObject({ i: itemId, type: z.literal('section'), title: z.string().min(1).max(200) }),
])

/** The Layout grid has 12 columns. */
export const layoutColumns = 12

const layoutItem = z.strictObject({
  i: itemId,
  x: z
    .int()
    .min(0)
    .max(layoutColumns - 1),
  y: z.int().min(0),
  w: z.int().min(1).max(layoutColumns),
  h: z.int().min(1),
  static: z.boolean().optional(),
})

/**
 * The structure of a Board document. `boardSchema` adds what JSON Schema cannot say on top of it:
 * item ids are unique, the Layout has exactly one entry per item, and no entry runs past column 12.
 */
export const boardStructure = z.strictObject({
  schema_version: z.literal(1),
  name: z.string().trim().min(1).max(200),
  filters,
  items: z.array(item).max(200),
  layout: z.array(layoutItem).max(200),
})

export const boardSchema = boardStructure.superRefine((board, ctx) => {
  const ids = new Set<string>()
  board.items.forEach((entry, index) => {
    if (ids.has(entry.i)) {
      ctx.addIssue({
        code: 'custom',
        path: ['items', index, 'i'],
        message: `Duplicate item id ${entry.i}`,
      })
    }
    ids.add(entry.i)
  })
  const placed = new Set<string>()
  board.layout.forEach((cell, index) => {
    if (!ids.has(cell.i)) {
      ctx.addIssue({ code: 'custom', path: ['layout', index, 'i'], message: `No item ${cell.i}` })
    }
    if (placed.has(cell.i)) {
      ctx.addIssue({
        code: 'custom',
        path: ['layout', index, 'i'],
        message: `Placed twice: ${cell.i}`,
      })
    }
    placed.add(cell.i)
    if (cell.x + cell.w > layoutColumns) {
      ctx.addIssue({ code: 'custom', path: ['layout', index, 'w'], message: 'Runs past column 12' })
    }
  })
  for (const id of ids) {
    if (!placed.has(id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['layout'],
        message: `Item ${id} has no place in the Layout`,
      })
    }
  }
})

/** The stored type and the schema must agree; this fails to compile when either drifts. */
export type ParsedBoard = z.infer<typeof boardSchema>
export const checkBoardType = (board: ParsedBoard): BoardDocument => board
export const checkSchemaType: z.ZodType<BoardDocument> = boardSchema

/** The JSON Schema (draft 2020-12) for `boardStructure`, as committed in `board.schema.json`. */
export function boardJsonSchema(): object {
  return z.toJSONSchema(boardStructure, { target: 'draft-2020-12', io: 'input' })
}
