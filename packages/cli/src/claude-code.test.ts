import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  applyTelemetry,
  readSettings,
  telemetryEnv,
  userSettingsPath,
  writeSettings,
} from './claude-code.ts'

const token = 'et_abcdefghijklmnop_0123456789012345678901234567890123456789'
const env = telemetryEnv('http://localhost:8787', token)
const fixture = (name: string) => join(import.meta.dirname, '..', 'test', 'fixtures', name)

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'embertrail-settings-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

/** Copies a fixture to a scratch file, so a test can run the writer on it. */
async function copyFixture(name: string) {
  const path = join(dir, 'settings.json')
  await writeFile(path, await readFile(fixture(name)))
  return path
}

describe('the telemetry env block', () => {
  it('turns on Metrics and Events over http/json for the Hub, authenticated by the Token', () => {
    expect(env).toEqual({
      CLAUDE_CODE_ENABLE_TELEMETRY: '1',
      OTEL_METRICS_EXPORTER: 'otlp',
      OTEL_LOGS_EXPORTER: 'otlp',
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
      OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE: 'delta',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:8787',
      OTEL_EXPORTER_OTLP_HEADERS: `Authorization=Bearer ${token}`,
    })
  })

  it('never sets a traces exporter', () => {
    expect(Object.keys(env).filter((key) => key.includes('TRACES'))).toEqual([])
    const settings = applyTelemetry({}, env)
    expect(JSON.stringify(settings)).not.toContain('TRACES')
  })
})

describe('applying it to a settings file with other keys', () => {
  it('leaves every other key and env entry intact', async () => {
    const before = await readSettings(fixture('settings-with-other-keys.json'))
    const after = applyTelemetry(before, env)
    expect(after).toEqual({ ...before, env: { ...(before.env as object), ...env } })
    expect(after.permissions).toEqual(before.permissions)
    expect(after.hooks).toEqual(before.hooks)
    // The user's own traces setting is theirs: this tool neither adds nor removes one.
    expect(after.env).toMatchObject({ DISABLE_AUTOUPDATER: '1', OTEL_TRACES_EXPORTER: 'none' })
  })

  it('is idempotent: a second run changes nothing, in memory or on disk', async () => {
    const path = await copyFixture('settings-with-other-keys.json')
    const once = applyTelemetry(await readSettings(path), env)
    expect(applyTelemetry(once, env)).toEqual(once)

    expect(await writeSettings(path, once)).toBe(true)
    const written = await readFile(path, 'utf8')
    expect(await writeSettings(path, applyTelemetry(await readSettings(path), env))).toBe(false)
    expect(await readFile(path, 'utf8')).toBe(written)
  })

  it('replaces an earlier telemetry setup rather than adding to it', async () => {
    const settings = applyTelemetry(
      await readSettings(fixture('settings-pointing-elsewhere.json')),
      env,
    )
    expect(settings).toEqual({ env, theme: 'dark' })
  })

  it('refuses an env that is not an object', () => {
    expect(() => applyTelemetry({ env: ['x'] }, env)).toThrow(/"env" that is not an object/)
  })
})

describe('the settings file', () => {
  it('is the user file, in CLAUDE_CONFIG_DIR when set', () => {
    const io = { home: '/home/me', env: {} } as Parameters<typeof userSettingsPath>[0]
    expect(userSettingsPath(io)).toBe('/home/me/.claude/settings.json')
    expect(userSettingsPath({ ...io, env: { CLAUDE_CONFIG_DIR: '/x' } })).toBe('/x/settings.json')
  })

  it('is created, with its directory, readable only by the user', async () => {
    const path = join(dir, 'new', 'settings.json')
    expect(await readSettings(path)).toEqual({})
    expect(await writeSettings(path, applyTelemetry({}, env))).toBe(true)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(await readFile(path, 'utf8')).toBe(`${JSON.stringify({ env }, null, 2)}\n`)
  })

  it('tightens an existing file to mode 600, keeping its other keys', async () => {
    const path = await copyFixture('settings-with-other-keys.json')
    const before = await readSettings(path)
    await chmod(path, 0o644)
    await writeSettings(path, applyTelemetry(before, env))
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(await readSettings(path)).toEqual({
      ...before,
      env: { ...(before.env as object), ...env },
    })
  })

  it('tightens a wide file that already holds the exact block, writing nothing', async () => {
    const path = join(dir, 'settings.json')
    await writeSettings(path, applyTelemetry({}, env))
    await chmod(path, 0o644)
    expect(await writeSettings(path, applyTelemetry(await readSettings(path), env))).toBe(false)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  it('corrects a cumulative temporality override to delta', async () => {
    const path = join(dir, 'settings.json')
    const cumulative = { env: { OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE: 'cumulative' } }
    await writeFile(path, JSON.stringify(cumulative))
    await writeSettings(path, applyTelemetry(await readSettings(path), env))
    const written = (await readSettings(path)).env as Record<string, string>
    expect(written.OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE).toBe('delta')
  })

  it('is written through a symlink, which stays a symlink', async () => {
    const real = join(dir, 'dotfiles', 'settings.json')
    await mkdir(join(dir, 'dotfiles'))
    await writeFile(real, '{"model":"opus"}\n')
    const link = join(dir, 'settings.json')
    await symlink(real, link)
    await writeSettings(link, applyTelemetry(await readSettings(link), env))
    expect((await lstat(link)).isSymbolicLink()).toBe(true)
    expect(JSON.parse(await readFile(real, 'utf8'))).toEqual({ model: 'opus', env })
  })

  it.each([
    ['is not valid JSON', '{ "model": '],
    ['is not a JSON object', '["a"]'],
  ])('fails, changing nothing, when it %s', async (_name, text) => {
    const path = join(dir, 'settings.json')
    await writeFile(path, text)
    await expect(readSettings(path)).rejects.toThrow(/Nothing was changed/)
    expect(await readFile(path, 'utf8')).toBe(text)
  })
})
