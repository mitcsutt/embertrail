import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec'

import type { CoreOp } from '../admin/core-op'
import { opScope } from '../module/define'
import type { Module, TypedOp } from '../module/define'
import { HubBootError } from '../module/errors'

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

/** Ingest takes a Token bound to a Source; an Edge Identity alone cannot send. */
const sourceBoundSecurity = { security: [{ bearerToken: [] }] }

const statusDescriptions = { 200: 'OK', 201: 'Created', 204: 'No Content' } as const

/**
 * A typed op's Operation Object: path, header and (for GET and DELETE) query parameters, or a
 * body; one response per status.
 */
function typedOperation(
  subject: Subject,
  key: string,
  op: Pick<
    TypedOp,
    'kind' | 'method' | 'path' | 'input' | 'output' | 'headers' | 'statuses' | 'etag'
  > &
    Partial<Pick<TypedOp, 'source'>>,
) {
  const input = jsonSchema(op.input, 'input', subject, key)
  const output = jsonSchema(op.output, 'output', subject, key)
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
  if (op.kind === 'mutate') parameters.push(ownerHeader)
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
    requestBody = {
      required: bodyRequired.length > 0,
      content: {
        'application/json': {
          schema: {
            ...input,
            properties: Object.fromEntries(rest.map((name) => [name, properties[name]])),
            required: bodyRequired,
          },
        },
      },
    }
  }
  return {
    ...(op.kind === 'ingest' ? sourceBoundSecurity : {}),
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(requestBody === undefined ? {} : { requestBody }),
    responses: {
      ...Object.fromEntries(
        op.statuses.map((status) => [
          String(status),
          {
            description: statusDescriptions[status],
            ...(op.etag ? { headers: { ETag: { $ref: '#/components/headers/ETag' } } } : {}),
            ...(status === 204 ? {} : { content: { 'application/json': { schema: output } } }),
          },
        ]),
      ),
      ...(op.source === 'refuse'
        ? { '403': { $ref: '#/components/responses/SourceRefused' } }
        : {}),
      default: { $ref: '#/components/responses/Problem' },
    },
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

/** `POST /api/v1/sql` (#34), as `runSql` in spec/query-api.yaml. */
const sqlOperation = {
  operationId: 'core.sql',
  summary: 'Run one read-only SQL statement',
  description:
    'Runs a single `SELECT` as the read-only database role, with the caller’s row-level security applied. 10 s statement timeout; at most 10,000 rows, and `truncated` says whether more existed.',
  'x-embertrail-module': 'core',
  'x-embertrail-scope': 'sql:read',
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['sql'],
          additionalProperties: false,
          properties: {
            sql: { type: 'string', minLength: 1, maxLength: 20_000 },
            params: {
              type: 'array',
              maxItems: 100,
              items: { type: ['string', 'number', 'boolean', 'null'] },
            },
          },
        },
      },
    },
  },
  responses: {
    '200': {
      description: 'The result set',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['columns', 'rows', 'truncated'],
            properties: {
              columns: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['name', 'type'],
                  properties: { name: { type: 'string' }, type: { type: 'string' } },
                },
              },
              rows: { type: 'array', maxItems: 10_000, items: { type: 'array' } },
              truncated: { type: 'boolean' },
            },
          },
        },
      },
    },
    default: { $ref: '#/components/responses/Problem' },
  },
}

/**
 * Assembles the Hub's OpenAPI 3.1 document from every op (#25) and the core's own ops (#30),
 * served at `/api/v1/openapi.json`. Built at boot, so a schema that can't convert fails boot.
 */
export function buildOpenApi(modules: readonly Module[], coreOps: readonly CoreOp[] = []) {
  const paths: Record<string, Json> = {
    '/api/v1/openapi.json': {
      get: {
        operationId: 'core.openapi',
        summary: 'This document',
        security: [],
        'x-embertrail-module': 'core',
        responses: {
          '200': {
            description: 'The OpenAPI document',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
    },
    '/api/v1/docs': {
      get: {
        operationId: 'core.docs',
        summary: 'Human-readable API reference rendered from `openapi.json`',
        security: [],
        'x-embertrail-module': 'core',
        responses: {
          '200': {
            description: 'HTML page.',
            content: { 'text/html': { schema: { type: 'string' } } },
          },
        },
      },
    },
    '/llms.txt': {
      get: {
        operationId: 'core.llmsTxt',
        summary: 'Plain-text pointer to the API for AI agents',
        security: [],
        'x-embertrail-module': 'core',
        responses: {
          '200': {
            description: 'Markdown text.',
            content: { 'text/markdown': { schema: { type: 'string' } } },
          },
        },
      },
    },
    '/api/v1/bootstrap': {
      post: {
        operationId: 'core.bootstrap',
        summary: 'Exchange BOOTSTRAP_TOKEN for the first User and an admin Token, once',
        description:
          'Authenticates with `Authorization: Bearer <BOOTSTRAP_TOKEN>`, not a Token. Answers 401 once an admin User exists or bootstrap has been used, and when BOOTSTRAP_TOKEN is unset or wrong.',
        security: [{ bearerToken: [] }],
        'x-embertrail-module': 'core',
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  name: { type: 'string', minLength: 1, maxLength: 200 },
                  email: { type: 'string', format: 'email' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'The first User and its admin Token, shown once',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['user', 'token'],
                  properties: {
                    user: {
                      type: 'object',
                      required: ['id', 'name', 'email', 'admin'],
                      properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                        email: { type: ['string', 'null'] },
                        admin: { type: 'boolean' },
                      },
                    },
                    token: { type: 'string', description: '`et_<id>_<secret>`' },
                  },
                },
              },
            },
          },
          default: { $ref: '#/components/responses/Problem' },
        },
      },
    },
    '/api/v1/sql': { post: sqlOperation },
  }
  for (const module of modules) {
    for (const [key, op] of Object.entries(module.ops)) {
      const operation = {
        operationId: `${module.name}.${key}`,
        summary: op.summary,
        'x-embertrail-module': module.name,
        'x-embertrail-scope': opScope(module.name, op),
        ...(op.kind === 'raw'
          ? { ...(op.source === 'require' ? sourceBoundSecurity : {}), ...op.openapi }
          : typedOperation(`Module "${module.name}"`, key, op)),
      }
      paths[op.path] = { ...paths[op.path], [op.method.toLowerCase()]: operation }
    }
  }
  for (const op of coreOps) {
    const generated = typedOperation('Hub core', op.key, {
      ...op,
      kind: 'query',
      headers: {},
      etag: false,
    })
    const operation = {
      operationId: `core.${op.key}`,
      summary: op.summary,
      ...(op.description === undefined ? {} : { description: op.description }),
      tags: [op.tag],
      'x-embertrail-module': 'core',
      'x-embertrail-scope': op.scope,
      ...generated,
      ...(op.responses === undefined
        ? {}
        : { responses: { ...op.responses, default: generated.responses.default } }),
    }
    paths[op.path] = { ...paths[op.path], [op.method.toLowerCase()]: operation }
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
