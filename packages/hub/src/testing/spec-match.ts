// Compares the OpenAPI document a Hub serves with a hand-written one (spec/query-api.yaml, #27).
// The served document is derived from the Modules' Zod schemas, so the two never match
// byte for byte: this compares what a client can observe and ignores how it is spelled.

type Json = Record<string, unknown>

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const methods = ['get', 'put', 'post', 'delete', 'patch'] as const

/**
 * Keys left out of the comparison: prose, examples, and limits. A limit (`maxItems`, `pattern`,
 * `format`, `additionalProperties`) is enforced by the schema the Hub validates with and is
 * tested at its boundary; spelling it twice here would only compare two renderings of it.
 */
const ignored = new Set([
  'description',
  'summary',
  'title',
  'tags',
  'externalDocs',
  'operationId',
  'deprecated',
  'example',
  'examples',
  'headers',
  'discriminator',
  '$defs',
  '$schema',
  'default',
  'format',
  'pattern',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minProperties',
  'maxProperties',
  'propertyNames',
  'additionalProperties',
  'unevaluatedProperties',
  // Conditional rules the served schema cannot express; the op's own validation enforces them.
  'if',
  'then',
  'else',
])

/** Types that, all together, accept any JSON value. */
const everyType = ['array', 'boolean', 'null', 'number', 'object', 'string']

function lookup(root: Json, ref: string, defs: readonly Json[]): unknown {
  if (ref.startsWith('#/$defs/')) {
    const name = ref.slice('#/$defs/'.length)
    return defs.find((scope) => name in scope)?.[name]
  }
  let node: unknown = root
  for (const part of ref.slice(2).split('/')) node = isRecord(node) ? node[part] : undefined
  return node
}

function sorted(values: readonly unknown[]) {
  const key = (value: unknown) => JSON.stringify(canonical(value))
  return [...values].sort((a, b) => key(a).localeCompare(key(b)))
}

function unionOf(types: readonly unknown[][]) {
  return [...new Set(types.flat())].sort()
}

/** Folds `anyOf` members that are only a `type` into the parent, so `T | null` has one spelling. */
function simplify(node: Json) {
  const result = { ...node }
  if (Array.isArray(result.oneOf)) {
    result.anyOf = result.oneOf
    delete result.oneOf
  }
  if (Array.isArray(result.allOf)) {
    const members = result.allOf.filter(isRecord)
    delete result.allOf
    for (const member of members) {
      const { properties, required, ...rest } = member
      Object.assign(result, rest)
      if (isRecord(properties))
        result.properties = { ...(result.properties as Json), ...properties }
      if (Array.isArray(required))
        result.required = [...(result.required as unknown[]), ...(required as unknown[])]
    }
  }
  // A constant or an enum already implies its type.
  if ('const' in result || 'enum' in result) delete result.type
  if (typeof result.type === 'string') result.type = [result.type]
  if (Array.isArray(result.anyOf)) {
    const members = result.anyOf.filter(isRecord)
    const bare = members.every((m) => Object.keys(m).length === 1 && Array.isArray(m.type))
    if (bare) {
      result.type = unionOf([
        (result.type as unknown[] | undefined) ?? [],
        ...members.map((m) => m.type as unknown[]),
      ])
      delete result.anyOf
    } else {
      const nulls = members.filter((m) => Object.keys(m).length === 1 && isNullType(m))
      const others = members.filter((m) => !nulls.includes(m))
      if (nulls.length === 1 && others.length === 1 && isRecord(others[0])) {
        Object.assign(result, others[0])
        result.type = unionOf([(others[0].type as unknown[] | undefined) ?? [], ['null']])
        delete result.anyOf
      } else if (
        everyType.every((t) => members.some((m) => (m.type as unknown[] | undefined)?.includes(t)))
      ) {
        // A union of every JSON type is "any JSON", which the spec writes as no schema at all.
        delete result.anyOf
      } else {
        result.anyOf = sorted(members)
      }
    }
  }
  if (
    Array.isArray(result.type) &&
    everyType.every((t) => (result.type as unknown[]).includes(t))
  ) {
    delete result.type
  }
  if (Array.isArray(result.required))
    result.required = [...new Set(result.required as string[])].sort()
  if (Array.isArray(result.type)) result.type = [...(result.type as string[])].sort()
  return result
}

function isNullType(node: Json) {
  return Array.isArray(node.type) && node.type.length === 1 && node.type[0] === 'null'
}

/** The comparable shape of a node: references resolved, prose and limits dropped. */
function shape(
  root: Json,
  node: unknown,
  defs: readonly Json[] = [],
  seen: readonly string[] = [],
): unknown {
  if (Array.isArray(node)) return node.map((member) => shape(root, member, defs, seen))
  if (!isRecord(node)) return node
  const scopes = isRecord(node.$defs) ? [node.$defs, ...defs] : defs
  if (typeof node.$ref === 'string') {
    // A reference back into itself is a recursive schema, which accepts anything here.
    if (seen.includes(node.$ref)) return {}
    return shape(root, lookup(root, node.$ref, scopes), scopes, [...seen, node.$ref])
  }
  const result: Json = {}
  for (const [key, value] of Object.entries(node)) {
    if (ignored.has(key)) continue
    if (key === 'enum' || key === 'const' || key === 'required') result[key] = value
    else if (key === 'properties' && isRecord(value)) {
      result[key] = Object.fromEntries(
        Object.entries(value).map(([name, schema]) => [name, shape(root, schema, scopes, seen)]),
      )
    } else result[key] = shape(root, value, scopes, seen)
  }
  return simplify(result)
}

function operations(document: Json) {
  const result = new Map<string, unknown>()
  const rootSecurity = document.security
  const paths = isRecord(document.paths) ? document.paths : {}
  for (const [path, item] of Object.entries(paths)) {
    if (!isRecord(item)) continue
    for (const method of methods) {
      const operation = item[method]
      if (!isRecord(operation)) continue
      const parameters = [item.parameters, operation.parameters].flatMap((list): unknown[] =>
        Array.isArray(list) ? (list as unknown[]) : [],
      )
      const normalized = parameters
        .map((parameter) => shape(document, parameter))
        .filter(isRecord)
        .map((p) => ({
          name: p.name,
          in: p.in,
          required: p.in === 'path' || p.required === true,
          schema: p.schema ?? {},
        }))
        .sort((a, b) =>
          `${String(a.in)} ${String(a.name)}`.localeCompare(`${String(b.in)} ${String(b.name)}`),
        )
      const body = shape(document, operation.requestBody)
      const responses = isRecord(operation.responses) ? operation.responses : {}
      result.set(
        `${method.toUpperCase()} ${path}`,
        canonical({
          module: operation['x-embertrail-module'],
          scope: operation['x-embertrail-scope'],
          security: operation.security ?? rootSecurity,
          parameters: normalized,
          requestBody: body,
          // Errors are RFC 9457 problems on every route; only the successes carry a contract.
          success: Object.fromEntries(
            Object.entries(responses)
              .filter(([status]) => status.startsWith('2'))
              .map(([status, response]) => [status, shape(document, response)]),
          ),
        }),
      )
    }
  }
  return result
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  )
}

function show(value: unknown) {
  const text = value === undefined ? 'missing' : JSON.stringify(value)
  return text.length > 240 ? `${text.slice(0, 240)}…` : text
}

function differences(served: unknown, spec: unknown, at: string, out: string[]) {
  if (JSON.stringify(served) === JSON.stringify(spec)) return
  if (Array.isArray(served) && Array.isArray(spec) && served.length === spec.length) {
    served.forEach((member, index) => {
      differences(member, spec[index], `${at}[${String(index)}]`, out)
    })
    return
  }
  if (isRecord(served) && isRecord(spec)) {
    for (const key of new Set([...Object.keys(served), ...Object.keys(spec)])) {
      differences(served[key], spec[key], `${at} › ${key}`, out)
    }
    return
  }
  out.push(`${at}: served ${show(served)}, spec ${show(spec)}`)
}

export interface SpecMatchOptions {
  /** Operations (`POST /api/v1/bootstrap`) the Hub serves that the spec does not describe yet. */
  servedOnly?: readonly string[]
  /** Operations the spec describes that the Hub does not serve. */
  specOnly?: readonly string[]
}

/**
 * Differences between the document a Hub serves and a hand-written spec, one line each; empty
 * when they agree. It compares each operation's Module, Scope, security, parameters, request
 * body and success responses by what they accept and return (types, properties, required keys,
 * enums, unions), not by how the schemas are written or by limits and prose. An allowed
 * exception that is no longer one is reported too, so the lists cannot go stale.
 */
export function compareOpenApi(served: unknown, spec: unknown, options: SpecMatchOptions = {}) {
  if (!isRecord(served) || !isRecord(spec)) return ['both documents must be JSON objects']
  const servedOps = operations(served)
  const specOps = operations(spec)
  const out: string[] = []
  const servedOnly = new Set(options.servedOnly)
  const specOnly = new Set(options.specOnly)
  for (const key of servedOps.keys()) {
    if (specOps.has(key)) {
      if (servedOnly.has(key)) out.push(`${key}: allowed as served-only, but the spec describes it`)
    } else if (!servedOnly.has(key)) out.push(`${key}: served but not in the spec`)
  }
  for (const key of specOps.keys()) {
    if (servedOps.has(key)) {
      if (specOnly.has(key)) out.push(`${key}: allowed as spec-only, but the Hub serves it`)
    } else if (!specOnly.has(key)) out.push(`${key}: in the spec but not served`)
  }
  for (const [key, operation] of servedOps) {
    if (specOps.has(key)) differences(operation, specOps.get(key), key, out)
  }
  for (const key of [...servedOnly, ...specOnly]) {
    if (!servedOps.has(key) && !specOps.has(key))
      out.push(`${key}: allowed but in neither document`)
  }
  return out
}
