import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec'

import { opScope } from '../module/define'
import type { Module, Op } from '../module/define'
import { HubBootError } from '../module/errors'

type Json = Record<string, unknown>

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function jsonSchema(
  schema: StandardSchemaV1,
  io: 'input' | 'output',
  module: Module,
  key: string,
): Json {
  const props: Partial<StandardJSONSchemaV1.Props> = schema['~standard']
  const fail = (why: string) =>
    new HubBootError(`Module "${module.name}"`, 'no JSON Schema', `op "${key}" ${io}: ${why}`)
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

/** A typed op's Operation Object: path and (for GET and DELETE) query parameters, or a body. */
function typedOperation(
  module: Module,
  key: string,
  op: Op & { kind: 'query' | 'mutate' | 'ingest' },
) {
  const input = jsonSchema(op.input, 'input', module, key)
  const output = jsonSchema(op.output, 'output', module, key)
  const properties = isRecord(input.properties) ? input.properties : {}
  const required = Array.isArray(input.required) ? (input.required as string[]) : []
  const inPath = [...op.path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1] ?? '')
  const parameters: Json[] = inPath.map((name) => ({
    name,
    in: 'path',
    required: true,
    schema: properties[name] ?? { type: 'string' },
  }))
  const rest = Object.keys(properties).filter((name) => !inPath.includes(name))
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
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(requestBody === undefined ? {} : { requestBody }),
    responses: {
      '200': { description: 'OK', content: { 'application/json': { schema: output } } },
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
 * Assembles the Hub's OpenAPI 3.1 document from every op (#25), served at
 * `/api/v1/openapi.json`. Built at boot, so a schema that can't convert fails boot.
 */
export function buildOpenApi(modules: readonly Module[]) {
  const paths: Record<string, Json> = {
    '/api/v1/openapi.json': {
      get: {
        operationId: 'core.openapi',
        summary: 'This document',
        security: [],
        'x-embertrail-module': 'core',
        responses: { '200': { description: 'The OpenAPI document' } },
      },
    },
  }
  for (const module of modules) {
    for (const [key, op] of Object.entries(module.ops)) {
      const operation = {
        operationId: `${module.name}.${key}`,
        summary: op.summary,
        'x-embertrail-module': module.name,
        'x-embertrail-scope': opScope(module.name, op),
        ...(op.kind === 'raw' ? op.openapi : typedOperation(module, key, op)),
      }
      paths[op.path] = { ...paths[op.path], [op.method.toLowerCase()]: operation }
    }
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
      responses: {
        Problem: {
          description: 'An error, as RFC 9457 problem details.',
          content: {
            'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } },
          },
        },
      },
    },
  }
}

export type OpenApiDocument = ReturnType<typeof buildOpenApi>
