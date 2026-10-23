// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { configPath, resolveHubConfig } from './hub-config.ts'
import type { Environment } from './hub-config.ts'

const environment = (
  env: Record<string, string>,
  files: Record<string, string> = {},
): Environment => ({
  env,
  home: '/home/someone',
  read: (path) => files[path],
})

describe('resolveHubConfig', () => {
  it('uses EMBERTRAIL_HUB and EMBERTRAIL_TOKEN when both are set', () => {
    const found = resolveHubConfig(
      environment({ EMBERTRAIL_HUB: 'http://hub.test:9/', EMBERTRAIL_TOKEN: 'et_a_b' }),
    )
    expect(found).toEqual({ hub: 'http://hub.test:9', token: 'et_a_b' })
  })

  it('reads what `embertrail login` stored, where the CLI looks', () => {
    const stored = JSON.stringify({ hub: 'http://localhost:8787', token: 'et_c_d' })
    const home = '/home/someone/.config/embertrail/config.json'
    expect(resolveHubConfig(environment({}, { [home]: stored }))).toEqual({
      hub: 'http://localhost:8787',
      token: 'et_c_d',
    })
    expect(configPath(environment({ XDG_CONFIG_HOME: '/xdg' }))).toBe('/xdg/embertrail/config.json')
    expect(configPath(environment({ EMBERTRAIL_CONFIG_DIR: '/etc/et' }))).toBe(
      '/etc/et/config.json',
    )
  })

  it('ignores one variable on its own, as the CLI does', () => {
    const stored = JSON.stringify({ hub: 'http://stored.test', token: 'et_s_t' })
    const path = '/home/someone/.config/embertrail/config.json'
    const found = resolveHubConfig(environment({ EMBERTRAIL_TOKEN: 'et_x_y' }, { [path]: stored }))
    expect(found.hub).toBe('http://stored.test')
  })

  it('says what to do when there is no config, or a broken one', () => {
    expect(() => resolveHubConfig(environment({}))).toThrow(/embertrail login/)
    const path = '/home/someone/.config/embertrail/config.json'
    expect(() => resolveHubConfig(environment({}, { [path]: '{ nope' }))).toThrow(/not valid JSON/)
    expect(() => resolveHubConfig(environment({}, { [path]: '{}' }))).toThrow(/not an embertrail/)
  })
})
