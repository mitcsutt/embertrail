import { exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import { packageName } from './index'

// Runs inside workerd through @cloudflare/vitest-plugin, proving the pool works before the
// Cloudflare Adapters need it.
describe('@mitcsutt/embertrail-worker', () => {
  it('runs in the Workers runtime', () => {
    expect(navigator.userAgent).toBe('Cloudflare-Workers')
    expect(packageName).toBe('@mitcsutt/embertrail-worker')
  })

  it('answers through its fetch handler', async () => {
    const response = await exports.default.fetch('https://hub.example/')
    expect(response.status).toBe(501)
  })
})
