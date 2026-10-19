// Reads examples out of spec/query-api.yaml, so the tests send what the spec
// documents rather than shapes made up next to them.

import { readFileSync } from 'node:fs'

import { parse } from 'yaml'

interface Media {
  example?: unknown
  examples?: Record<string, { value: unknown }>
}

interface SpecDocument {
  paths: Record<
    string,
    Record<string, { requestBody?: { content: Record<string, Media> } } | undefined>
  >
  components: { responses: Record<string, { content: Record<string, Media> }> }
}

const spec = parse(
  readFileSync(new URL('../../../spec/query-api.yaml', import.meta.url), 'utf8'),
) as SpecDocument

/** The request body example of one operation; `name` picks one of several `examples`. */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the caller names the type its example has
export function requestExample<T>(path: string, method: string, name?: string): T {
  const media = spec.paths[path]?.[method]?.requestBody?.content['application/json']
  const value = name === undefined ? media?.example : media?.examples?.[name]?.value
  if (value === undefined) throw new Error(`No request example for ${method} ${path} ${name ?? ''}`)
  return value as T
}

/** The example body of a shared response, such as `BadRequest`. */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the caller names the type its example has
export function responseExample<T>(response: string): T {
  const value = spec.components.responses[response]?.content['application/problem+json']?.example
  if (value === undefined) throw new Error(`No example for response ${response}`)
  return value as T
}
