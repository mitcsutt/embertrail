import { chmod, mkdir, readFile, realpath } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { writePrivateFile } from './config.ts'
import { CliError } from './errors.ts'
import type { Io } from './io.ts'

/**
 * The `env` block that points Claude Code's telemetry at a Hub: on, Metrics and Events (OTLP
 * logs) exported over `http/json` with delta temporality (the Hub refuses cumulative sums),
 * authenticated by the Source's ingest Token. Traces are never enabled: there is no `OTEL_TRACES_EXPORTER` here, and the Hub does not store them.
 */
export function telemetryEnv(hub: string, token: string): Record<string, string> {
  return {
    CLAUDE_CODE_ENABLE_TELEMETRY: '1',
    OTEL_METRICS_EXPORTER: 'otlp',
    OTEL_LOGS_EXPORTER: 'otlp',
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
    OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE: 'delta',
    OTEL_EXPORTER_OTLP_ENDPOINT: hub,
    OTEL_EXPORTER_OTLP_HEADERS: `Authorization=Bearer ${token}`,
  }
}

/**
 * `settings` with `env` set to include the telemetry block. Every other key, and every other
 * `env` entry, is kept as it is; applying the same block twice changes nothing.
 */
export function applyTelemetry(
  settings: Record<string, unknown>,
  env: Record<string, string>,
): Record<string, unknown> {
  const existing = settings.env
  if (
    existing !== undefined &&
    (typeof existing !== 'object' || existing === null || Array.isArray(existing))
  ) {
    throw new CliError(
      'The settings file has an "env" that is not an object; fix it, then run this again',
    )
  }
  return { ...settings, env: { ...existing, ...env } }
}

/**
 * The user settings file: `$CLAUDE_CONFIG_DIR/settings.json`, else `~/.claude/settings.json`. It
 * is the user file because its `env` overrides shell variables, and project settings cannot set
 * exporters.
 */
export function userSettingsPath(io: Io): string {
  return join(io.env.CLAUDE_CONFIG_DIR ?? join(io.home, '.claude'), 'settings.json')
}

/** The settings in `path`: `{}` when there is no file, a CliError when it is not a JSON object. */
export async function readSettings(path: string): Promise<Record<string, unknown>> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
  if (text.trim() === '') return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new CliError(
      `${path} is not valid JSON (${error instanceof Error ? error.message : String(error)}); fix it, then run this again. Nothing was changed.`,
    )
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new CliError(
      `${path} is not a JSON object; fix it, then run this again. Nothing was changed.`,
    )
  }
  return parsed as Record<string, unknown>
}

/**
 * Writes `settings` to `path` as two-space JSON. The file holds a Token, so it is always mode 600,
 * whatever mode it had and even when its content is already right. A symlink (a dotfiles repo's)
 * is written through, not replaced. Returns false, writing nothing, when the file already says
 * exactly this.
 */
export async function writeSettings(
  path: string,
  settings: Record<string, unknown>,
): Promise<boolean> {
  const text = `${JSON.stringify(settings, null, 2)}\n`
  let target = path
  try {
    target = await realpath(path)
    if ((await readFile(target, 'utf8')) === text) {
      await chmod(target, 0o600)
      return false
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await mkdir(dirname(path), { recursive: true })
  }
  await writePrivateFile(target, text)
  return true
}

/** Where the settings send telemetry: their `OTEL_EXPORTER_OTLP_ENDPOINT`, if they set one. */
export function telemetryEndpoint(settings: Record<string, unknown>): string | undefined {
  const env = settings.env
  if (typeof env !== 'object' || env === null) return undefined
  const endpoint = (env as Record<string, unknown>).OTEL_EXPORTER_OTLP_ENDPOINT
  return typeof endpoint === 'string' ? endpoint : undefined
}

/**
 * `settings` without the telemetry block `telemetryEnv` writes, the reverse of `applyTelemetry`:
 * every other key and `env` entry is kept, and an `env` left empty is removed.
 */
export function removeTelemetry(settings: Record<string, unknown>): Record<string, unknown> {
  const { env, ...rest } = settings
  if (typeof env !== 'object' || env === null || Array.isArray(env)) return settings
  const ours = new Set(Object.keys(telemetryEnv('', '')))
  const kept = Object.fromEntries(Object.entries(env).filter(([key]) => !ours.has(key)))
  return Object.keys(kept).length === 0 ? rest : { ...rest, env: kept }
}
