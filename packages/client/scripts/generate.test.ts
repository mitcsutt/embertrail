import { readFile } from 'node:fs/promises'
import { relative } from 'node:path'

import { describe, expect, it } from 'vitest'

import { generate } from './generate.ts'

describe('the generated client', () => {
  it('matches a fresh run against spec/query-api.yaml', async () => {
    for (const [path, expected] of await generate()) {
      const committed = await readFile(path, 'utf8')
      expect(
        committed,
        `${relative(process.cwd(), path)} is stale: run pnpm --filter @mitcsutt/embertrail-client generate`,
      ).toBe(expected)
    }
  })
})
