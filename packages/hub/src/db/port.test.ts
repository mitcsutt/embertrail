import { afterEach, describe, expect, it } from 'vitest'

import { dbPortChecks } from '../contract/index'
import { pgliteDb } from '../testing/pglite'
import type { ClosableDbPort } from '../testing/pglite'

describe('the Test Db Adapter (PGLite)', () => {
  let port: ClosableDbPort | undefined

  afterEach(async () => {
    await port?.close()
  })

  it.each(dbPortChecks)('$name', async (check) => {
    port = pgliteDb()
    await expect(check.run(port)).resolves.toBeUndefined()
  })
})
