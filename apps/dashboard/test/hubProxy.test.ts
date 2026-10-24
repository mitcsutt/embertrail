import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { defaultHub, isCrossOrigin, resolveHubProxy } from '../scripts/hubProxy.ts'

let dir: string
let emptyDir: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'embertrail-proxy-'))
  emptyDir = await mkdtemp(join(tmpdir(), 'embertrail-proxy-'))
  await writeFile(
    join(dir, 'config.json'),
    JSON.stringify({ hub: 'http://stored.test:1', token: 'et_stored_token' }),
  )
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
  await rm(emptyDir, { recursive: true, force: true })
})

function io(configDir: string, env: Record<string, string> = {}) {
  return {
    env: { EMBERTRAIL_CONFIG_DIR: configDir, ...env },
    home: configDir,
    fetch: globalThis.fetch,
    stdout: () => undefined,
    stderr: () => undefined,
    hostname: 'test-host',
    exec: () => Promise.reject(new Error('the proxy runs no programs')),
    portFree: () => Promise.resolve(true),
  }
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

describe('isCrossOrigin', () => {
  const host = 'localhost:5173'

  it('accepts requests the Dashboard itself makes', () => {
    expect(isCrossOrigin({ host })).toBe(false)
    expect(isCrossOrigin({ host, 'sec-fetch-site': 'same-origin' })).toBe(false)
    expect(isCrossOrigin({ host, origin: `http://${host}` })).toBe(false)
  })

  it('refuses a request from another site, however the browser says so', () => {
    expect(isCrossOrigin({ host, 'sec-fetch-site': 'cross-site' })).toBe(true)
    expect(isCrossOrigin({ host, 'sec-fetch-site': 'same-site' })).toBe(true)
    expect(isCrossOrigin({ host, origin: 'http://evil.test' })).toBe(true)
    expect(isCrossOrigin({ host, origin: 'null' })).toBe(true)
  })
})

// Which Hub and Token the rule picks is tested in packages/cli/src/config.test.ts; this is the
// proxy's own part: the default Hub and the header.
describe('resolveHubProxy', () => {
  it('uses the local Hub with no Token when nothing is set or stored', async () => {
    await expect(resolveHubProxy(io(emptyDir))).resolves.toEqual({
      target: defaultHub,
      headers: {},
    })
  })

  it('sends the Token as a bearer header to the Hub the rule picks', async () => {
    await expect(resolveHubProxy(io(dir))).resolves.toEqual({
      target: 'http://stored.test:1',
      headers: bearer('et_stored_token'),
    })
    await expect(
      resolveHubProxy(io(dir, { EMBERTRAIL_HUB: 'http://other.test:2' })),
    ).resolves.toEqual({ target: 'http://other.test:2', headers: {} })
  })
})
