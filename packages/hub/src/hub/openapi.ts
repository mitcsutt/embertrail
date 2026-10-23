import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec'

import { HubBootError } from '../module/errors'
import type { HubOp, TypedHubOp } from './pipeline'

type Json = Record<string, unknown>

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `Module "<name>"`, or `core` for the core's own ops: who a boot error names. */
type Subject = string

function jsonSchema(
  schema: StandardSchemaV1,
  io: 'input' | 'output',
  subject: Subject,
  key: string,
): Json {
  const props: Partial<StandardJSONSchemaV1.Props> = schema['~standard']
  const fail = (why: string) =>
    new HubBootError(subject, 'no JSON Schema', `op "${key}" ${io}: ${why}`)
  if (props.jsonSchema === undefined) {
    throw fail('the schema has no JSON Schema converter; use a Standard JSON Schema library')
  }
  let converted: Json
  try {
    converted = props.jsonSchema[io]({ target: 'draft-2020-12' })
  } catch (error) {
    throw fail(error instanceof Error ? error.message : String(error))
  }
  // The document's jsonSchemaDialect already says 2020-12.
  return Object.fromEntries(Object.entries(converted).filter(([k]) => k !== '$schema'))
}

const ownerHeader = {
  name: 'Embertrail-Owner',
  in: 'header',
  required: false,
  description:
    'Act for a Team instead of the caller: `team:<id>`. The caller must be an editor of that Team. Omit on the solo path.',
  schema: { type: 'string', pattern: '^team:[A-Za-z0-9_-]{1,64}$' },
}

/** Ingest and bootstrap take a bearer Token; an Edge Identity alone cannot call them. */
const tokenOnly = { security: [{ bearerToken: [] }] }

const statusDescriptions = { 200: 'OK', 201: 'Created', 204: 'No Content' } as const

/**
 * A typed op's Operation Object, from the schemas that validate it: path, header and (for GET
 * and DELETE) query parameters, or a body; one response per status.
 */
function typedOperation(subject: Subject, op: TypedHubOp) {
  const input = jsonSchema(op.input, 'input', subject, op.key)
  const output = jsonSchema(op.output, 'output', subject, op.key)
  const properties = isRecord(input.properties) ? input.properties : {}
  const required = Array.isArray(input.required) ? (input.required as string[]) : []
  const inPath = [...op.path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1] ?? '')
  const parameters: Json[] = inPath.map((name) => ({
    name,
    in: 'path',
    required: true,
    schema: properties[name] ?? { type: 'string' },
  }))
  for (const [name, header] of Object.entries(op.headers)) {
    parameters.push({
      name: header,
      in: 'header',
      required: required.includes(name),
      schema: properties[name] ?? { type: 'string' },
    })
  }
  // The core reads this header before any op runs, so every write can name a Team.
  if (op.ownerHeader) parameters.push(ownerHeader)
  const rest = Object.keys(properties).filter(
    (name) => !inPath.includes(name) && !Object.hasOwn(op.headers, name),
  )
  let requestBody: Json | undefined
  if (op.method === 'GET' || op.method === 'DELETE') {
    for (const name of rest) {
      parameters.push({
        name,
        in: 'query',
        required: required.includes(name),
        schema: properties[name],
      })
    }
  } else if (!isRecord(input.properties)) {
    // A union such as `mode: list | aggregate` has no top-level properties: it is the body.
    requestBody = { required: true, content: { 'application/json': { schema: input } } }
  } else if (rest.length > 0) {
    const bodyRequired = required.filter((name) => rest.includes(name))
    const schema = Object.fromEntries(Object.entries(input).filter(([k]) => k !== 'required'))
    requestBody = {
      required: bodyRequired.length > 0,
      content: {
        'application/json': {
          schema: {
            ...schema,
            properties: Object.fromEntries(rest.map((name) => [name, properties[name]])),
            ...(bodyRequired.length > 0 ? { required: bodyRequired } : {}),
          },
        },
      },
    }
  }
  const problem = { default: { $ref: '#/components/responses/Problem' } }
  return {
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(requestBody === undefined ? {} : { requestBody }),
    responses:
      op.responses === undefined
        ? {
            ...Object.fromEntries(
              op.statuses.map((status) => [
                String(status),
                {
                  description: statusDescriptions[status],
                  ...(op.etag ? { headers: { ETag: { $ref: '#/components/headers/ETag' } } } : {}),
                  ...(status === 204
                    ? {}
                    : { content: { 'application/json': { schema: output } } }),
                },
              ]),
            ),
            ...(op.auth.kind === 'scope' && op.auth.source === 'refuse'
              ? { '403': { $ref: '#/components/responses/SourceRefused' } }
              : {}),
            ...problem,
          }
        : { ...op.responses, ...problem },
  }
}

/** Who may call the op, as OpenAPI security; omitted, the document's default applies. */
function security(op: HubOp) {
  if (op.auth.kind === 'public') return { security: [] }
  if (op.auth.kind === 'bootstrap' || op.auth.source === 'require') return tokenOnly
  return {}
}

function operation(op: HubOp) {
  const subject = op.module === 'core' ? 'Hub core' : `Module "${op.module}"`
  return {
    operationId: `${op.module}.${op.key}`,
    summary: op.summary,
    ...(op.description === undefined ? {} : { description: op.description }),
    ...(op.tags === undefined ? {} : { tags: op.tags }),
    'x-embertrail-module': op.module,
    ...(op.auth.kind === 'scope' ? { 'x-embertrail-scope': op.auth.scope } : {}),
    ...security(op),
    ...(op.kind === 'raw' ? op.openapi : typedOperation(subject, op)),
  }
}

const problemSchema = {
  type: 'object',
  description: 'RFC 9457 problem details.',
  required: ['type', 'title', 'status', 'request_id'],
  properties: {
    type: { type: 'string', format: 'uri' },
    title: { type: 'string' },
    status: { type: 'integer' },
    detail: { type: 'string' },
    request_id: { type: 'string' },
    module: { type: 'string', description: 'Module that raised the error, on `internal`.' },
    sqlstate: { type: 'string', description: 'Postgres SQLSTATE, on `sql-error`.' },
    errors: {
      type: 'array',
      items: {
        type: 'object',
        required: ['pointer', 'message'],
        properties: { pointer: { type: 'string' }, message: { type: 'string' } },
      },
    },
  },
}

/**
 * Assembles the Hub's OpenAPI 3.1 document from every op it serves (#79), served at
 * `/api/v1/openapi.json`. Built at boot, so a schema that can't convert fails boot.
 */
export function buildOpenApi(ops: readonly HubOp[]) {
  const paths: Record<string, Json> = {}
  for (const op of ops) {
    paths[op.path] = { ...paths[op.path], [op.method.toLowerCase()]: operation(op) }
  }
  return {
    openapi: '3.1.0',
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    info: {
      title: 'Embertrail Hub API',
      version: '1.0.0-draft',
      license: { name: 'Apache-2.0', identifier: 'Apache-2.0' },
    },
    security: [{ bearerToken: [] }, { edgeIdentity: [] }],
    paths,
    components: {
      securitySchemes: {
        bearerToken: { type: 'http', scheme: 'bearer' },
        edgeIdentity: { type: 'apiKey', in: 'header', name: 'Cf-Access-Jwt-Assertion' },
      },
      schemas: { Problem: problemSchema },
      headers: {
        ETag: {
          description: 'Strong validator for the returned version; send it back in `If-Match`.',
          schema: { type: 'string' },
        },
      },
      responses: {
        Problem: {
          description: 'An error, as RFC 9457 problem details.',
          content: {
            'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } },
          },
        },
        SourceRefused: {
          description:
            'Missing Scope, or a Token bound to a Source (an ingest Token), which this operation refuses (`forbidden`).',
          content: {
            'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } },
          },
        },
      },
    },
  }
}

export type OpenApiDocument = ReturnType<typeof buildOpenApi>
