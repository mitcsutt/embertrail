import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { defineModule, op } from '../module/define'
import { buildOpenApi } from './openapi'
import { hubOps } from './ops'

type Operation = Record<string, unknown>

function operation(document: ReturnType<typeof buildOpenApi>, path: string, method: string) {
  const item = document.paths[path] as Record<string, Operation> | undefined
  return item?.[method]
}

const unionModule = defineModule({
  contract: 1,
  name: 'shapes',
  tables: {},
  migrations: [],
  ops: {
    query: op.query({
      method: 'POST',
      path: '/api/v1/shapes/query',
      summary: 'Takes one of two shapes',
      input: z.discriminatedUnion('mode', [
        z.object({ mode: z.literal('list'), limit: z.number() }),
        z.object({ mode: z.literal('count') }),
      ]),
      output: z.object({}),
      run: () => Promise.resolve({}),
    }),
    write: op.mutate({
      method: 'PUT',
      path: '/api/v1/shapes/{id}',
      summary: 'Writes',
      input: z.object({ id: z.string(), name: z.string() }),
      output: z.object({}),
      run: () => Promise.resolve({}),
    }),
    ingest: op.ingest({
      path: '/api/v1/shapes/ingest',
      summary: 'Ingests',
      input: z.object({ name: z.string() }),
      output: z.object({}),
      run: () => Promise.resolve({}),
    }),
  },
})

describe('buildOpenApi', () => {
  const document = buildOpenApi(hubOps([unionModule]))

  it('uses the whole schema as the body of an op whose input is a union', () => {
    expect(operation(document, '/api/v1/shapes/query', 'post')?.requestBody).toMatchObject({
      required: true,
      content: { 'application/json': { schema: { oneOf: [{}, {}] } } },
    })
  })

  it('lists Embertrail-Owner on writes, and only on writes', () => {
    const owner = { name: 'Embertrail-Owner', in: 'header', required: false }
    expect(operation(document, '/api/v1/shapes/{id}', 'put')?.parameters).toContainEqual(
      expect.objectContaining(owner),
    )
    expect(operation(document, '/api/v1/shapes/query', 'post')?.parameters).toBeUndefined()
  })

  it('lists only a Token as the security of an ingest op', () => {
    expect(operation(document, '/api/v1/shapes/ingest', 'post')?.security).toEqual([
      { bearerToken: [] },
    ])
    expect(operation(document, '/api/v1/shapes/query', 'post')?.security).toBeUndefined()
  })

  it('describes the public routes the core serves', () => {
    for (const path of ['/api/v1/openapi.json', '/api/v1/health', '/api/v1/docs', '/llms.txt']) {
      expect(operation(document, path, 'get')).toMatchObject({
        security: [],
        'x-embertrail-module': 'core',
      })
    }
  })
})
