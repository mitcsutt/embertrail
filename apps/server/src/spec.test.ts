import { readFileSync } from 'node:fs'

import { compareOpenApi, testHub } from '@mitcsutt/embertrail-hub/testing'
import { otel } from '@mitcsutt/embertrail-otel'
import { store } from '@mitcsutt/embertrail-store'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

// The Hub serves an OpenAPI document built from its Modules' ops; spec/query-api.yaml is the
// hand-written contract the client is generated from (#27). Either changing alone fails here.
describe('the served OpenAPI document', () => {
  it('matches spec/query-api.yaml', async () => {
    const t = await testHub({ modules: [otel, store] })
    try {
      const response = await t.anonymous.get('/api/v1/openapi.json')
      expect(response.status).toBe(200)
      const spec: unknown = parse(
        readFileSync(new URL('../../../spec/query-api.yaml', import.meta.url), 'utf8'),
      )
      expect(compareOpenApi(await response.json(), spec)).toEqual([])
    } finally {
      await t.close()
    }
  }, 60_000)
})
