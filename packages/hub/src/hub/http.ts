import type { StandardSchemaV1 } from '@standard-schema/spec'

import { EdgeIdentityError } from '../identity/edge'
import { HubError, problemTitles } from '../module/errors'

/** Keys the core stamps; a caller can never set them (#25 invariant 2). */
const stampedKeys = new Set(['owner_id', 'source_id'])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (request.method === 'GET') return {}
  const text = await request.text()
  if (text.trim() === '') return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw HubError.validation([{ pointer: '', message: 'Body is not valid JSON' }])
  }
  if (!isPlainObject(parsed)) {
    throw HubError.validation([{ pointer: '', message: 'Body must be a JSON object' }])
  }
  return parsed
}

/**
 * An op's input: body, then query, then path parameters, merged, then the op's `headers`,
 * which only a header can set. Stamped keys are removed.
 */
export async function readInput(
  request: Request,
  params: Record<string, string>,
  headers: Readonly<Record<string, string>> = {},
) {
  // A Map, so a key such as __proto__ is only ever data.
  const query = new Map<string, string | string[]>()
  for (const [key, value] of new URL(request.url).searchParams) {
    const seen = query.get(key)
    query.set(key, seen === undefined ? value : [...(Array.isArray(seen) ? seen : [seen]), value])
  }
  const fromHeaders = new Map<string, string>()
  for (const [key, name] of Object.entries(headers)) {
    const value = request.headers.get(name)
    if (value !== null) fromHeaders.set(key, value)
  }
  const merged = { ...(await readBody(request)), ...Object.fromEntries(query), ...params }
  return Object.fromEntries(
    [
      ...Object.entries(merged).filter(([key]) => !Object.hasOwn(headers, key)),
      ...fromHeaders,
    ].filter(([key]) => !stampedKeys.has(key)),
  )
}

function pointer(path: StandardSchemaV1.Issue['path']) {
  return (path ?? [])
    .map((segment) => {
      const key = typeof segment === 'object' ? segment.key : segment
      return `/${String(key).replaceAll('~', '~0').replaceAll('/', '~1')}`
    })
    .join('')
}

/** Validates against a Standard Schema; failures are a 400 with one error per issue. */
export async function validate<T>(schema: StandardSchemaV1<unknown, T>, value: unknown) {
  const result = await schema['~standard'].validate(value)
  if (result.issues !== undefined) {
    throw HubError.validation(
      result.issues.map((issue) => ({ pointer: pointer(issue.path), message: issue.message })),
    )
  }
  return result.value
}

/** The HubError a thrown value maps to, or undefined for an unexpected failure (500). */
export function knownError(error: unknown): HubError | undefined {
  if (error instanceof HubError) return error
  if (error instanceof EdgeIdentityError) return HubError.unauthenticated(error.message)
  return undefined
}

/** RFC 9457 problem details, as spec/query-api.yaml describes them. */
export function problem(error: HubError, requestId: string, module?: string): Response {
  const body = {
    type: `urn:embertrail:problem:${error.slug}`,
    title: problemTitles[error.slug],
    status: error.status,
    ...(error.detail === undefined ? {} : { detail: error.detail }),
    request_id: requestId,
    ...(module === undefined ? {} : { module }),
    ...(error.errors === undefined ? {} : { errors: error.errors }),
  }
  return Response.json(body, {
    status: error.status,
    headers: { 'content-type': 'application/problem+json' },
  })
}

/** A typed op returned a value its output schema rejects: the Module's bug, so a 500. */
export class OutputError extends Error {
  override readonly name = 'OutputError'

  constructor(
    readonly op: string,
    readonly issues: readonly StandardSchemaV1.Issue[],
    why = 'returned output that fails its schema',
  ) {
    super(`op "${op}" ${why}`)
  }
}

/** An op's output, parsed by its schema so undeclared keys never leave the Hub. */
export async function parseOutput(schema: StandardSchemaV1, value: unknown, op: string) {
  const result = await schema['~standard'].validate(value)
  if (result.issues !== undefined) throw new OutputError(op, result.issues)
  return result.value
}
