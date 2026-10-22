import { describe, expect, it } from 'vitest'

import { compareOpenApi } from './spec-match'

const problem = { description: 'An error.' }

/** A hand-written spec, with `$ref`s, `type: [T, 'null']` and prose. */
const spec = {
  openapi: '3.1.0',
  security: [{ bearerToken: [] }],
  paths: {
    '/api/v1/things/{id}': {
      get: {
        summary: 'Get a thing',
        'x-embertrail-module': 'things',
        'x-embertrail-scope': 'things:read',
        parameters: [{ $ref: '#/components/parameters/Id' }],
        responses: {
          '200': {
            description: 'The thing',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Thing' } } },
          },
          '404': problem,
        },
      },
    },
  },
  components: {
    parameters: { Id: { name: 'id', in: 'path', required: true, schema: { type: 'string' } } },
    schemas: {
      Thing: {
        type: 'object',
        required: ['id', 'note'],
        properties: {
          id: { type: 'string', minLength: 1 },
          note: { type: ['string', 'null'] },
          data: {},
        },
      },
    },
  },
}

/** The same contract as the Hub renders it: inline, `anyOf` for null, every limit spelled out. */
function served() {
  return {
    openapi: '3.1.0',
    security: [{ bearerToken: [] }, { edgeIdentity: [] }],
    paths: {
      '/api/v1/things/{id}': {
        get: {
          'x-embertrail-module': 'things',
          'x-embertrail-scope': 'things:read',
          security: [{ bearerToken: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      note: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                      id: { type: 'string', pattern: '^.+$' },
                      data: {
                        anyOf: [
                          { type: 'string' },
                          { type: 'number' },
                          { type: 'boolean' },
                          { type: 'null' },
                          { type: 'array', items: {} },
                          { type: 'object', additionalProperties: {} },
                        ],
                      },
                    },
                    required: ['id', 'note'],
                    additionalProperties: false,
                  },
                },
              },
            },
            default: { $ref: '#/components/responses/Problem' },
          },
        },
      },
    },
  }
}

describe('compareOpenApi', () => {
  it('ignores prose, limits and how a schema is spelled', () => {
    expect(compareOpenApi(served(), spec)).toEqual([])
  })

  it('reports an operation on one side only', () => {
    const extra = served()
    Object.assign(extra.paths, { '/api/v1/other': { post: { responses: {} } } })
    expect(compareOpenApi(extra, spec)).toEqual(['POST /api/v1/other: served but not in the spec'])
    expect(compareOpenApi({ paths: {} }, spec)).toEqual([
      'GET /api/v1/things/{id}: in the spec but not served',
    ])
  })

  it('reports a Scope, a required key, a type and a parameter that differ', () => {
    const drifted = served()
    const get = drifted.paths['/api/v1/things/{id}'].get
    get['x-embertrail-scope'] = 'things:write'
    const schema = get.responses['200'].content['application/json'].schema
    schema.required = ['id']
    schema.properties.id = { type: 'integer', pattern: '' }
    get.parameters.push({ name: 'q', in: 'path', required: true, schema: { type: 'string' } })
    const found = compareOpenApi(drifted, spec).join('\n')
    expect(found).toContain('scope: served "things:write", spec "things:read"')
    expect(found).toContain('› required: served ["id"], spec ["id","note"]')
    expect(found).toContain('› id › type[0]: served "integer", spec "string"')
    expect(found).toContain('parameters')
  })

  it('lets an operation be served-only, and fails once that exception is stale', () => {
    const extra = served()
    Object.assign(extra.paths, { '/api/v1/other': { post: { responses: {} } } })
    expect(compareOpenApi(extra, spec, { servedOnly: ['POST /api/v1/other'] })).toEqual([])
    expect(compareOpenApi(served(), spec, { servedOnly: ['POST /api/v1/other'] })).toEqual([
      'POST /api/v1/other: allowed but in neither document',
    ])
    expect(compareOpenApi(served(), spec, { servedOnly: ['GET /api/v1/things/{id}'] })).toEqual([
      'GET /api/v1/things/{id}: allowed as served-only, but the spec describes it',
    ])
  })
})
