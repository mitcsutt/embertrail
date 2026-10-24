import { hubModules } from '@mitcsutt/embertrail-modules'
import { exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import worker from './index'

// Runs inside workerd through @cloudflare/vitest-plugin.
describe('@mitcsutt/embertrail-worker', () => {
  it('runs in the Workers runtime', () => {
    expect(navigator.userAgent).toBe('Cloudflare-Workers')
  })

  it('exports the fetch and scheduled handlers', () => {
    expect(typeof worker.fetch).toBe('function')
    expect(typeof worker.scheduled).toBe('function')
  })

  it('answers 501 until the Hub is wired in', async () => {
    const response = await exports.default.fetch('https://hub.example/api/v1/self')
    expect(response.status).toBe(501)
  })

  it('can load the Modules the Docker Platform loads', () => {
    expect(hubModules.map((m) => m.name)).toEqual(['otel', 'store'])
  })
})
