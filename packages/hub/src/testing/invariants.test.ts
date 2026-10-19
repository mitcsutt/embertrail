import { describe, expect, it } from 'vitest'

import { hubInvariantChecks } from './invariants'
import { pgliteDb } from './pglite'

describe('Module contract invariants on PGLite', () => {
  it.each(hubInvariantChecks)('$name', async (check) => {
    await expect(check.run(() => Promise.resolve(pgliteDb()))).resolves.toBeUndefined()
  })
})
