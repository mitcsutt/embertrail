import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { readConfig, resolveTarget } from './config.ts'

const stored = { hub: 'http://stored.test:1', token: 'et_stored' }
let withLogin: string
let withoutLogin: string

beforeAll(async () => {
  withLogin = await mkdtemp(join(tmpdir(), 'embertrail-config-'))
  withoutLogin = await mkdtemp(join(tmpdir(), 'embertrail-config-'))
  await writeFile(join(withLogin, 'config.json'), JSON.stringify(stored))
})

afterAll(async () => {
  await rm(withLogin, { recursive: true, force: true })
  await rm(withoutLogin, { recursive: true, force: true })
})

const io = (dir: string, env: Record<string, string>) => ({
  env: { EMBERTRAIL_CONFIG_DIR: dir, ...env },
  home: dir,
})

describe('which Hub and which Token', () => {
  const cases: {
    name: string
    login: boolean
    env: Record<string, string>
    defaultHub?: string
    expected: { hub: string | undefined; token: string | undefined }
  }[] = [
    {
      name: 'nothing set or stored',
      login: false,
      env: {},
      expected: { hub: undefined, token: undefined },
    },
    {
      name: 'nothing set or stored, with a default Hub',
      login: false,
      env: {},
      defaultHub: 'http://localhost:8787/',
      expected: { hub: 'http://localhost:8787', token: undefined },
    },
    { name: 'only the stored login', login: true, env: {}, expected: stored },
    {
      name: 'both variables beat the stored login',
      login: true,
      env: { EMBERTRAIL_HUB: 'http://env.test:9/', EMBERTRAIL_TOKEN: 'et_env' },
      expected: { hub: 'http://env.test:9', token: 'et_env' },
    },
    {
      name: 'both variables with no stored login',
      login: false,
      env: { EMBERTRAIL_HUB: 'http://env.test:9', EMBERTRAIL_TOKEN: 'et_env' },
      expected: { hub: 'http://env.test:9', token: 'et_env' },
    },
    {
      name: 'only the Token: it replaces the stored one for the stored Hub',
      login: true,
      env: { EMBERTRAIL_TOKEN: 'et_env' },
      expected: { hub: stored.hub, token: 'et_env' },
    },
    {
      name: 'only the Token, with no stored login: there is no Hub',
      login: false,
      env: { EMBERTRAIL_TOKEN: 'et_env' },
      expected: { hub: undefined, token: 'et_env' },
    },
    {
      name: 'only the stored Hub: the stored Token goes with it',
      login: true,
      env: { EMBERTRAIL_HUB: 'http://stored.test:1/' },
      expected: stored,
    },
    {
      name: 'only another Hub: the stored Token is never sent to it',
      login: true,
      env: { EMBERTRAIL_HUB: 'http://other.test:2' },
      expected: { hub: 'http://other.test:2', token: undefined },
    },
    {
      name: 'empty variables count as unset',
      login: true,
      env: { EMBERTRAIL_HUB: '', EMBERTRAIL_TOKEN: '' },
      expected: stored,
    },
  ]

  it.each(cases)('$name', async ({ login, env, defaultHub, expected }) => {
    await expect(
      resolveTarget(io(login ? withLogin : withoutLogin, env), {
        ...(defaultHub === undefined ? {} : { defaultHub }),
      }),
    ).resolves.toEqual(expected)
  })

  it.each(cases.filter(({ defaultHub }) => defaultHub === undefined))(
    'readConfig: $name',
    async ({ login, env, expected }) => {
      await expect(readConfig(io(login ? withLogin : withoutLogin, env))).resolves.toEqual(
        expected.hub === undefined || expected.token === undefined
          ? undefined
          : { hub: expected.hub, token: expected.token },
      )
    },
  )
})
