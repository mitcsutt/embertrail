import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createClient } from '@mitcsutt/embertrail-client'
import { testHub } from '@mitcsutt/embertrail-hub/testing'
import type { TestHub } from '@mitcsutt/embertrail-hub/testing'
import { hubModules } from '@mitcsutt/embertrail-modules'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { removeTelemetry, telemetryEnv } from './claude-code.ts'
import { run } from './cli.ts'
import type { ExecOptions, ExecResult, Io } from './io.ts'
import { composeFile, sourceName } from './local/stack.ts'

const ok = (stdout = ''): ExecResult => ({ code: 0, stdout, stderr: '' })

/**
 * Docker Compose as the local stack sees it: `up` boots a real Hub on PGLite with the
 * `BOOTSTRAP_TOKEN` the CLI wrote to `.env`, `down` stops it and `down --volumes` deletes it.
 */
class FakeDocker {
  hub: TestHub | undefined
  running = false
  readonly calls: string[][] = []
  installed = true
  failing: ((words: string[]) => boolean) | undefined

  constructor(private readonly dir: string) {}

  /** The Compose words after the global options, such as `['up', '--detach', …]`. */
  composeCalls(): string[][] {
    return this.calls
      .filter((args) => args[0] === 'compose' && args[1] === '--project-name')
      .map((args) => args.slice(args.indexOf('dashboard') + 1))
  }

  exec = async (
    program: string,
    args: readonly string[],
    options: ExecOptions = {},
  ): Promise<ExecResult> => {
    if (!this.installed) throw Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' })
    expect(program).toBe('docker')
    this.calls.push([...args])
    if (args[0] === 'info' || args[1] === 'version') return ok('27.0.0')
    if (args[0] === 'volume')
      return ok(this.hub === undefined ? '' : 'embertrail-local_postgres-data\n')
    const words = args.slice(args.indexOf('dashboard') + 1)
    if (this.failing?.(words)) throw new Error(`docker compose ${words[0] ?? ''} failed`)
    switch (words[0]) {
      case 'up': {
        if (this.hub === undefined) {
          const env = await readFile(join(this.dir, '.env'), 'utf8')
          const bootstrapToken = /^BOOTSTRAP_TOKEN=(.+)$/m.exec(env)?.[1]
          this.hub = await testHub({
            modules: hubModules,
            config: bootstrapToken === undefined ? {} : { bootstrapToken },
          })
        }
        this.running = true
        return ok()
      }
      case 'down':
        this.running = false
        if (words.includes('--volumes')) {
          await this.hub?.close()
          this.hub = undefined
        }
        return ok()
      case 'ps':
        return ok(
          this.running
            ? ['hub', 'postgres', 'dashboard']
                .map((service) =>
                  JSON.stringify({ Service: service, State: 'running', Health: 'healthy' }),
                )
                .join('\n')
            : '',
        )
      case 'exec':
        if (options.stdoutFile !== undefined) await writeFile(options.stdoutFile, '-- dump\n')
        return ok()
      default:
        return ok()
    }
  }

  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    if (!this.running || this.hub === undefined) throw new TypeError('fetch failed')
    // The Dashboard's nginx answers config.json; everything else is the Hub.
    if (new URL(request.url).pathname === '/config.json') return Response.json({ hubUrl: '' })
    return this.hub.hub.fetch(request)
  }
}

let home: string
let docker: FakeDocker
let busy: Set<number>
let extraEnv: Record<string, string>
const local = () => join(home, 'local')
const settingsPath = () => join(home, 'claude', 'settings.json')

async function cli(...argv: string[]) {
  let out = ''
  let err = ''
  const io: Io = {
    env: {
      EMBERTRAIL_CONFIG_DIR: join(home, 'config'),
      EMBERTRAIL_LOCAL_DIR: local(),
      CLAUDE_CONFIG_DIR: join(home, 'claude'),
      ...extraEnv,
    },
    home,
    hostname: 'Alices-MacBook-Pro.local',
    fetch: docker.fetch,
    stdout: (text) => {
      out += typeof text === 'string' ? text : new TextDecoder().decode(text)
    },
    stderr: (text) => {
      err += text
    },
    exec: docker.exec,
    portFree: (port) => Promise.resolve(!busy.has(port)),
  }
  return { code: await run(argv, io), out, err }
}

async function composeServices(): Promise<Record<string, { image?: string; build?: unknown }>> {
  const text = await readFile(join(local(), 'compose.yaml'), 'utf8')
  return (parse(text) as { services: Record<string, { image?: string; build?: unknown }> }).services
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'embertrail-local-'))
  docker = new FakeDocker(local())
  busy = new Set()
  extraEnv = {}
})

afterEach(async () => {
  await docker.hub?.close()
  await rm(home, { recursive: true, force: true })
})

describe('embertrail up', () => {
  it('goes from nothing to a bootstrapped Hub, a Dashboard with its own Token and Claude Code connected', async () => {
    const { code, out, err } = await cli('up')
    expect(err).toBe('')
    expect(code).toBe(0)
    expect(out).toContain('Embertrail is running.')
    expect(out).toContain('http://localhost:8080')
    expect(out).toContain('http://localhost:8787')
    expect(out).toContain('Source "alices-macbook-pro"')

    // The CLI is logged in as the Hub's one admin, and no Token was printed.
    const config = await readJson(join(home, 'config', 'config.json'))
    expect(config.hub).toBe('http://localhost:8787')
    expect(out).not.toContain(String(config.token))
    expect(out).not.toMatch(/et_[a-z0-9]{16}_/)
    const users = await docker.hub?.hub.directory.users()
    expect(users).toHaveLength(1)
    expect(users?.[0]?.admin).toBe(true)

    // Every file is private, and the stack pulls its images rather than building them.
    for (const file of ['state.json', '.env', 'compose.yaml']) {
      expect((await stat(join(local(), file))).mode & 0o777).toBe(0o600)
    }
    const env = await readFile(join(local(), '.env'), 'utf8')
    expect(env).toMatch(/^BOOTSTRAP_TOKEN=[0-9a-f]{64}$/m)
    expect(env).toMatch(/^POSTGRES_PASSWORD=[0-9a-f]{48}$/m)
    const dashboardToken = /^EMBERTRAIL_DASHBOARD_TOKEN=(et_\S+)$/m.exec(env)?.[1]
    expect(dashboardToken).toBeDefined()
    const compose = await composeServices()
    for (const service of Object.values(compose)) expect(service.build).toBeUndefined()
    expect(compose.hub?.image).toContain('ghcr.io/mitcsutt/embertrail:')

    // The Dashboard's Token holds only what the Dashboard uses.
    const manage = createClient({
      baseUrl: 'http://localhost:8787',
      token: String(config.token),
      fetch: docker.fetch,
    })
    const dashboard = (await manage.listTokens()).items.find((t) => t.name === 'dashboard')
    expect(dashboard?.scopes.toSorted()).toEqual(['otel:read', 'store:read', 'store:write'])
    expect(dashboard?.source_id).toBeNull()

    // The Hub started first, then the whole stack, Dashboard included.
    expect(docker.composeCalls()).toEqual([
      ['up', '--detach', '--wait', 'hub'],
      ['up', '--detach', '--wait'],
    ])

    const settings = await readJson(settingsPath())
    expect(settings.env).toMatchObject({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:8787' })
  })

  it('changes nothing the second time', async () => {
    await cli('up')
    const before = await readFile(settingsPath(), 'utf8')
    const env = await readFile(join(local(), '.env'), 'utf8')
    const { code, out } = await cli('up')
    expect(code).toBe(0)
    expect(out).toContain('already pointed here')
    expect(await readFile(settingsPath(), 'utf8')).toBe(before)
    expect(await readFile(join(local(), '.env'), 'utf8')).toBe(env)
    expect(await docker.hub?.hub.directory.users()).toHaveLength(1)
  })

  it('remembers the Source it was given', async () => {
    await cli('up', '--source', 'work')
    const before = await readFile(settingsPath(), 'utf8')
    const { out } = await cli('up')
    expect(out).toContain('Source "work"')
    expect(await readFile(settingsPath(), 'utf8')).toBe(before)
  })

  it('refuses a port in use before starting anything', async () => {
    busy.add(8787)
    const { code, err } = await cli('up')
    expect(code).toBe(1)
    expect(err).toContain('Port 8787 is in use')
    expect(err).toContain('--hub-port')
    expect(docker.composeCalls()).toEqual([])

    const moved = await cli(
      'up',
      '--hub-port',
      '28787',
      '--dashboard-port',
      '28080',
      '--no-claude-code',
    )
    expect(moved.code).toBe(0)
    expect(moved.out).toContain('http://localhost:28787')
    expect(moved.out).toContain('left alone')
    await expect(stat(settingsPath())).rejects.toThrow()
  })

  it('says what to do when the state is lost but the database is not', async () => {
    await cli('up')
    await rm(join(local(), 'state.json'))
    const { code, err } = await cli('up')
    expect(code).toBe(1)
    expect(err).toContain('docker volume rm embertrail-local_postgres-data')
    expect(docker.composeCalls()).toHaveLength(2)
  })

  it('builds from a checkout when asked, and remembers it', async () => {
    const { code } = await cli('up', '--build-from', '/src/embertrail', '--no-claude-code')
    expect(code).toBe(0)
    const compose = await composeServices()
    expect(compose.hub?.build).toEqual({ context: '/src/embertrail' })
    expect(compose.dashboard?.build).toEqual({
      context: '/src/embertrail',
      dockerfile: 'apps/dashboard/Dockerfile',
    })
    expect(docker.composeCalls()[0]).toEqual(['up', '--detach', '--wait', '--build', 'hub'])
  })

  it('names Docker when it is missing', async () => {
    docker.installed = false
    const { code, err } = await cli('up')
    expect(code).toBe(1)
    expect(err).toContain('Install Docker')
  })
})

const remote = 'https://hub.example'
const remoteEnv = telemetryEnv(remote, 'et_remote')
const configFile = () => join(home, 'config', 'config.json')

async function logInElsewhere() {
  await mkdir(join(home, 'config'), { recursive: true })
  await writeFile(configFile(), JSON.stringify({ hub: remote, token: 'et_remote' }))
  await mkdir(join(home, 'claude'), { recursive: true })
  await writeFile(
    settingsPath(),
    JSON.stringify({ theme: 'dark', env: { ...remoteEnv, MINE: '1' } }),
  )
}

describe('embertrail up on a machine that uses another Hub', () => {
  it('keeps the login and the Claude Code target, still starts the stack and says how to switch', async () => {
    await logInElsewhere()
    const login = await readFile(configFile(), 'utf8')
    const settings = await readFile(settingsPath(), 'utf8')

    const { code, out } = await cli('up')
    expect(code).toBe(0)
    expect(out).toContain('Embertrail is running.')
    expect(out).toContain(`login to ${remote}`)
    expect(out).toContain(`target ${remote}`)
    expect(out).toContain('--switch')
    expect(await readFile(configFile(), 'utf8')).toBe(login)
    expect(await readFile(settingsPath(), 'utf8')).toBe(settings)
    expect(docker.running).toBe(true)
    await expect(stat(`${configFile()}.backup`)).rejects.toThrow()
  })

  it('--switch backs both up beside themselves, then writes the local values', async () => {
    await logInElsewhere()
    const { code } = await cli('up', '--switch')
    expect(code).toBe(0)
    expect(await readJson(`${configFile()}.backup`)).toEqual({ hub: remote, token: 'et_remote' })
    expect(await readJson(`${settingsPath()}.embertrail-backup`)).toEqual(remoteEnv)
    expect((await stat(`${configFile()}.backup`)).mode & 0o777).toBe(0o600)
    expect((await readJson(configFile())).hub).toBe('http://localhost:8787')
    expect((await readJson(settingsPath())).env).toMatchObject({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:8787',
      MINE: '1',
    })
  })

  it('--switch refuses to overwrite an earlier backup', async () => {
    await logInElsewhere()
    await writeFile(`${configFile()}.backup`, '{}')
    const { code, err } = await cli('up', '--switch')
    expect(code).toBe(1)
    expect(err).toContain('earlier backup')
    expect(docker.composeCalls()).toEqual([])
    expect((await readJson(configFile())).hub).toBe(remote)
  })

  it('reset restores what --switch backed up', async () => {
    await logInElsewhere()
    await cli('up', '--switch')
    const { code, out } = await cli('reset', '--yes')
    expect(code).toBe(0)
    expect(out).toContain('Restored')
    expect(await readJson(configFile())).toEqual({ hub: remote, token: 'et_remote' })
    expect(await readJson(settingsPath())).toEqual({
      theme: 'dark',
      env: { ...remoteEnv, MINE: '1' },
    })
    await expect(stat(`${configFile()}.backup`)).rejects.toThrow()
    await expect(stat(`${settingsPath()}.embertrail-backup`)).rejects.toThrow()
  })

  it('reset leaves settings and a login that point elsewhere alone', async () => {
    await cli('up')
    await logInElsewhere()
    const login = await readFile(configFile(), 'utf8')
    const settings = await readFile(settingsPath(), 'utf8')
    expect((await cli('reset', '--yes')).code).toBe(0)
    expect(await readFile(configFile(), 'utf8')).toBe(login)
    expect(await readFile(settingsPath(), 'utf8')).toBe(settings)
  })

  it('says so when EMBERTRAIL_HUB and EMBERTRAIL_TOKEN keep the CLI on another Hub', async () => {
    extraEnv = { EMBERTRAIL_HUB: remote, EMBERTRAIL_TOKEN: 'et_remote' }
    const { code, out } = await cli('up')
    expect(code).toBe(0)
    expect(out).toContain(`EMBERTRAIL_HUB is set, so this CLI keeps using ${remote}`)
    expect(out).not.toContain('has no Token')
    expect((await readJson(configFile())).hub).toBe('http://localhost:8787')
  })

  it('says there is no Token when only EMBERTRAIL_HUB names another Hub', async () => {
    extraEnv = { EMBERTRAIL_HUB: remote }
    const { code, out } = await cli('up')
    expect(code).toBe(0)
    expect(out).toContain(`EMBERTRAIL_HUB is set, so this CLI keeps using ${remote}`)
    expect(out).toContain('has no Token for that Hub')
  })

  it('keeps a login and target at the same URL that this stack did not write', async () => {
    const local = 'http://localhost:8787'
    await mkdir(join(home, 'config'), { recursive: true })
    await writeFile(configFile(), JSON.stringify({ hub: local, token: 'et_handrun' }))
    await mkdir(join(home, 'claude'), { recursive: true })
    await writeFile(settingsPath(), JSON.stringify({ env: telemetryEnv(local, 'et_handrun') }))
    const login = await readFile(configFile(), 'utf8')
    const settings = await readFile(settingsPath(), 'utf8')

    const { out } = await cli('up')
    expect(out).toContain('Kept')
    expect(await readFile(configFile(), 'utf8')).toBe(login)
    expect(await readFile(settingsPath(), 'utf8')).toBe(settings)

    await cli('reset', '--yes')
    expect(await readFile(configFile(), 'utf8')).toBe(login)
    expect(await readFile(settingsPath(), 'utf8')).toBe(settings)
  })

  it('--switch writes its backups only once the stack is up, so a rerun after a failure works', async () => {
    await logInElsewhere()
    docker.failing = () => true
    expect((await cli('up', '--switch')).code).toBe(1)
    await expect(stat(`${configFile()}.backup`)).rejects.toThrow()
    await expect(stat(`${settingsPath()}.embertrail-backup`)).rejects.toThrow()
    docker.failing = undefined
    expect((await cli('up', '--switch')).code).toBe(0)
    expect(await readJson(`${configFile()}.backup`)).toEqual({ hub: remote, token: 'et_remote' })
  })

  it('accepts an identical earlier backup', async () => {
    await logInElsewhere()
    await cli('up', '--switch')
    await cli('reset', '--yes')
    await logInElsewhere()
    await writeFile(
      `${configFile()}.backup`,
      `${JSON.stringify({ hub: remote, token: 'et_remote' }, null, 2)}\n`,
    )
    expect((await cli('up', '--switch')).code).toBe(0)
  })

  it('moving the ports is not another Hub', async () => {
    await cli('up')
    const { out } = await cli('up', '--hub-port', '28787')
    expect(out).not.toContain('Kept')
    expect((await readJson(configFile())).hub).toBe('http://localhost:28787')
  })
})

describe('the rest of the lifecycle', () => {
  it('status shows where to click, and down stops the stack', async () => {
    expect((await cli('status')).out).toContain('no local stack')
    await cli('up')

    const running = await cli('status')
    expect(running.code).toBe(0)
    expect(running.out).toContain('Embertrail is running.')
    expect(running.out).toMatch(/Dashboard\s+http:\/\/localhost:8080\s+ok/)
    expect(running.out).toMatch(/hub\s+running \(healthy\)/)
    expect(running.out).toContain('Claude Code on this machine sends to this Hub.')

    expect((await cli('down')).out).toContain('Your data stays')
    const stopped = await cli('status', '--json')
    expect(JSON.parse(stopped.out)).toMatchObject({ exists: true, running: false, services: [] })

    // The same Hub comes back.
    await cli('up')
    expect(await docker.hub?.hub.directory.users()).toHaveLength(1)
  })

  it('upgrade snapshots the database before moving the images', async () => {
    await cli('up', '--no-claude-code')
    const { code, out } = await cli('upgrade', '--version', '0.2.0')
    expect(code).toBe(0)
    expect(out).toContain('to 0.2.0')
    const backups = await readdir(join(local(), 'backups'))
    expect(backups).toHaveLength(1)
    expect(await readFile(join(local(), 'backups', backups[0] ?? ''), 'utf8')).toBe('-- dump\n')
    expect(await readFile(join(local(), '.env'), 'utf8')).toContain('EMBERTRAIL_VERSION=0.2.0')
    const words = docker.composeCalls().map((call) => call[0])
    expect(words.slice(words.indexOf('exec'))).toEqual(['exec', 'pull', 'up'])
  })

  it('upgrade puts the previous image tag back when the pull fails', async () => {
    await cli('up', '--no-claude-code')
    docker.failing = (words) => words[0] === 'pull'
    const { code, err } = await cli('upgrade', '--version', '0.2.O')
    expect(code).toBe(1)
    expect(err).toContain('pull failed')
    expect(await readFile(join(local(), '.env'), 'utf8')).not.toContain('EMBERTRAIL_VERSION=0.2.O')
    expect((await readJson(join(local(), 'state.json'))).imageTag).not.toBe('0.2.O')
  })

  it('upgrade keeps the new tag and names the snapshot when the Hub fails after the pull', async () => {
    await cli('up', '--no-claude-code')
    docker.failing = (words) => words[0] === 'up' && !words.includes('postgres')
    const { code, err } = await cli('upgrade', '--version', '0.2.0')
    expect(code).toBe(1)
    expect(err).toContain('up failed')
    const backups = await readdir(join(local(), 'backups'))
    expect(err).toContain(join(local(), 'backups', backups[0] ?? ''))
    expect((await readJson(join(local(), 'state.json'))).imageTag).toBe('0.2.0')
  })

  it('reset asks for --yes, then deletes the stack and unhooks Claude Code', async () => {
    await cli('up')
    const settings = await readJson(settingsPath())
    await writeFile(
      settingsPath(),
      JSON.stringify({
        ...settings,
        theme: 'dark',
        env: { ...(settings.env as object), MINE: '1' },
      }),
    )

    const refused = await cli('reset')
    expect(refused.code).toBe(1)
    expect(refused.err).toContain('--yes')
    expect(docker.hub).toBeDefined()

    const { code, out } = await cli('reset', '--yes')
    expect(code).toBe(0)
    expect(out).toContain('Deleted the local stack')
    expect(docker.hub).toBeUndefined()
    expect(await readJson(settingsPath())).toEqual({ theme: 'dark', env: { MINE: '1' } })
    await expect(stat(join(home, 'config', 'config.json'))).rejects.toThrow()
    expect(await readdir(local())).toEqual([])

    // A new stack starts from nothing.
    expect((await cli('up')).code).toBe(0)
  })
})

describe('the stack files', () => {
  it('drops the build sections unless building from a checkout', () => {
    const services = (buildFrom: string | null) =>
      (
        parse(composeFile(buildFrom)) as {
          services: Record<string, { build?: unknown }>
        }
      ).services
    for (const service of Object.values(services(null))) expect(service.build).toBeUndefined()
    const built = services('/repo')
    expect(built.hub?.build).toEqual({ context: '/repo' })
    expect(built.dashboard?.build).toEqual({
      context: '/repo',
      dockerfile: 'apps/dashboard/Dockerfile',
    })
    expect(built.postgres?.build).toBeUndefined()
  })

  it('names the Source after this machine, within the Source name rules', () => {
    expect(sourceName('Alices-MacBook-Pro.local')).toBe('alices-macbook-pro')
    expect(sourceName('dev box_2')).toBe('dev-box-2')
    expect(sourceName('__')).toBe('laptop')
    expect(sourceName('')).toBe('laptop')
    expect(sourceName('a'.repeat(80))).toHaveLength(64)
  })

  it('removes only the telemetry block from Claude Code settings', () => {
    const env = telemetryEnv('http://localhost:8787', 'et_x')
    expect(removeTelemetry({ theme: 'dark', env: { ...env, MINE: '1' } })).toEqual({
      theme: 'dark',
      env: { MINE: '1' },
    })
    expect(removeTelemetry({ env })).toEqual({})
  })
})
