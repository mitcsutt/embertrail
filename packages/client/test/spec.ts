// Reads examples out of spec/query-api.yaml, so the tests send what the spec
// documents rather than shapes made up next to them.

import { readFileSync } from 'node:fs'

import { parse } from 'yaml'

interface SpecDocument {
  components: { responses: Record<string, { content: Record<string, { example?: unknown }> }> }
}

const spec = parse(
  readFileSync(new URL('../../../spec/query-api.yaml', import.meta.url), 'utf8'),
) as SpecDocument

/** The example body of a shared response, such as `BadRequest`. */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the caller names the type its example has
export function responseExample<T>(response: string): T {
  const value = spec.components.responses[response]?.content['application/problem+json']?.example
  if (value === undefined) throw new Error(`No example for response ${response}`)
  return value as T
}
