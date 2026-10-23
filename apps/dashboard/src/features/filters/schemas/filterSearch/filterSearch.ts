import { z } from 'zod'

import { relativeRangeNames } from '#features/filters/constants/relativeRanges'
import { isCalendarDate } from '#features/filters/utils/resolveWindow'

const date = z.string().refine(isCalendarDate)

// The router parses search values as JSON, so an id that looks like a number arrives as one.
const id = z.union([z.string(), z.number()]).transform(String)

/** A field that fails validation is dropped on its own; the rest of the URL still applies. */
const lenient = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined)

/**
 * The filters in a Board's URL. `range` is a relative range or `custom`, which takes `from` and
 * `to` (`YYYY-MM-DD`, both inclusive). `source`, `account` and `model` pick one value each; an
 * empty string means "all", for a Board whose saved filters pick one.
 */
export const filterSearchSchema = z.object({
  range: lenient(z.enum([...relativeRangeNames, 'custom'])),
  from: lenient(date),
  to: lenient(date),
  source: lenient(id),
  account: lenient(id),
  model: lenient(id),
})

export type FilterSearch = z.infer<typeof filterSearchSchema>
