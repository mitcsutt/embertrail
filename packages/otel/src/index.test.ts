import { describe, expect, it } from 'vitest'

import { packageName } from './index'

describe('@mitcsutt/embertrail-otel', () => {
  it('is wired into the workspace', () => {
    expect(packageName).toBe('@mitcsutt/embertrail-otel')
  })
})
