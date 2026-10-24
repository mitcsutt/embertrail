import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { testHub } from '@mitcsutt/embertrail-hub/testing'
import type { TestHub } from '@mitcsutt/embertrail-hub/testing'
import { hubModules } from '@mitcsutt/embertrail-modules'

import { run } from '../cli.ts'
import type { Io } from '../io.ts'

export const hubUrl = 'http://hub.test'

/** The parts of `Io` beyond the Hub and the terminal, for tests that run no programs. */
export const noPrograms: Pick<Io, 'hostname' | 'exec' | 'portFree'> = {
  hostname: 'test-host',
  exec: () => Promise.reject(new Error('this test runs no programs')),
  portFree: () => Promise.resolve(true),
}

export interface Result {
  code: number
  out: string
  err: string
}

export interface Harness {
  t: TestHub
  /** A scratch directory standing in for the user's home, with its own config and Claude dirs. */
  home: string
  env: Record<string, string>
  /** The management Token of the admin User `alice`, as `embertrail login` would store it. */
  token: string
  /** Answers requests to URLs under each origin, such as a fake Prometheus, instead of the Hub. */
  upstreams: Map<string, (request: Request) => Response | Promise<Response>>
  /** Runs the CLI with `argv` against the test Hub. */
  cli(...argv: string[]): Promise<Result>
  close(): Promise<void>
}

/** The real Hub on PGLite, reached by the CLI through an injected `fetch`, and a scratch home. */
export async function startHarness(): Promise<Harness> {
  const t = await testHub({ modules: hubModules })
  const home = await mkdtemp(join(tmpdir(), 'embertrail-cli-'))
  await t.user('alice', { admin: true })
  const { token } = await t.hub.directory.issueToken('alice', {
    kind: 'management',
    scopes: t.hub.scopes,
  })
  const env = {
    EMBERTRAIL_CONFIG_DIR: join(home, 'config'),
    CLAUDE_CONFIG_DIR: join(home, 'claude'),
  }
  const upstreams = new Map<string, (request: Request) => Response | Promise<Response>>()
  return {
    t,
    home,
    env,
    token,
    upstreams,
    async cli(...argv) {
      let out = ''
      let err = ''
      const io: Io = {
        ...noPrograms,
        env,
        home,
        fetch: async (input, init) => {
          const request = new Request(input, init)
          const upstream = upstreams.get(new URL(request.url).origin)
          return upstream === undefined ? t.hub.fetch(request) : upstream(request)
        },
        stdout: (text) => {
          out += typeof text === 'string' ? text : new TextDecoder().decode(text)
        },
        stderr: (text) => {
          err += text
        },
      }
      return { code: await run(argv, io), out, err }
    },
    async close() {
      await t.close()
      await rm(home, { recursive: true, force: true })
    },
  }
}
