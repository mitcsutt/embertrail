import { readFileSync } from 'node:fs'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { probe } from '../testing/probe'
import { testHub } from '../testing/test-hub'
import type { TestHub } from '../testing/test-hub'
import { coreOps } from './ops'

type Operation = Record<string, unknown>
type Paths = Record<string, Record<string, Operation | undefined> | undefined>

const spec = parse(
  readFileSync(new URL('../../../../spec/query-api.yaml', import.meta.url), 'utf8'),
) as { paths: Paths }

describe('the Admin and self-management API’s OpenAPI', () => {
  let t: TestHub
  let served: { paths: Paths }

  beforeAll(async () => {
    t = await testHub({ modules: [probe('alpha')] })
    served = (await (await t.anonymous.get('/api/v1/openapi.json')).json()) as { paths: Paths }
  })

  afterAll(() => t.close())

  it.each(coreOps.map((op) => [op.key, op] as const))(
    '%s is served at /api/v1/openapi.json as spec/query-api.yaml lists it',
    (key, op) => {
      const method = op.method.toLowerCase()
      const operation = served.paths[op.path]?.[method]
      expect(operation).toMatchObject({
        operationId: `core.${key}`,
        tags: [op.tag],
        'x-embertrail-module': 'core',
        'x-embertrail-scope': op.scope,
      })
      expect(spec.paths[op.path]?.[method]).toMatchObject({
        operationId: key,
        tags: [op.tag],
        'x-embertrail-module': 'core',
        'x-embertrail-scope': op.scope,
      })
    },
  )

  it('lists every core admin and self operation the spec has, and bootstrap, getSelf and getRates', () => {
    const specified = Object.entries(spec.paths).flatMap(([path, item]) =>
      Object.entries(item ?? {})
        .filter(([, operation]) => {
          const tags = operation?.tags as string[] | undefined
          return tags?.includes('admin') === true || tags?.includes('self') === true
        })
        .map(([method]) => `${method.toUpperCase()} ${path}`),
    )
    expect(specified.sort()).toEqual(
      [
        ...coreOps.map((op) => `${op.method} ${op.path}`),
        'GET /api/v1/self',
        'GET /api/v1/rates',
        'POST /api/v1/bootstrap',
      ].sort(),
    )
    expect(served.paths['/api/v1/bootstrap']?.post).toBeDefined()
  })

  it('documents each body, path parameter and status from the op’s schemas', () => {
    expect(served.paths['/api/v1/self/tokens']?.post).toMatchObject({
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { required: ['kind', 'scopes'] } },
        },
      },
      responses: { '201': { description: 'Created' }, default: expect.any(Object) as unknown },
    })
    expect(served.paths['/api/v1/admin/users/{user_id}']?.delete).toMatchObject({
      parameters: [{ name: 'user_id', in: 'path', required: true }],
      responses: { '204': { description: 'No Content' } },
    })
    expect(served.paths['/api/v1/self/export/{module}']?.get).toMatchObject({
      responses: { '200': { content: { 'application/jsonl': { schema: { type: 'string' } } } } },
    })
  })
})
