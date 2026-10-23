import { describe, expect, it } from 'vitest'

import { hubModules } from './index'

describe('hubModules', () => {
  it('names the otel and store Modules, otel first', () => {
    expect(hubModules.map((m) => m.name)).toEqual(['otel', 'store'])
  })
})
