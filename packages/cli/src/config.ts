import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { CliError } from './errors.ts'
import type { Io } from './io.ts'

/** What `embertrail login` stores: the Hub and a management Token. */
export interface StoredConfig {
  hub: string
  token: string
}

/**
 * The config file: `$EMBERTRAIL_CONFIG_DIR/config.json`, else `$XDG_CONFIG_HOME/embertrail/`,
 * else `~/.config/embertrail/`.
 */
export function configPath(io: Pick<Io, 'env' | 'home'>): string {
  const dir =
    io.env.EMBERTRAIL_CONFIG_DIR ??
    join(io.env.XDG_CONFIG_HOME ?? join(io.home, '.config'), 'embertrail')
  return join(dir, 'config.json')
}

/**
 * Writes `text` to `path` readable by the user only (mode 600, in a mode 700 directory when
 * this creates it): written to a sibling file first, then renamed over `path`, so no reader
 * sees a half-written file and an old, wider mode never survives.
 */
export async function writePrivateFile(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${String(process.pid)}.tmp`
  await writeFile(temporary, text, { mode: 0o600 })
  // The mode above is filtered by the umask and ignored for an existing file.
  await chmod(temporary, 0o600)
  await rename(temporary, path)
}

export async function writeConfig(io: Io, config: StoredConfig): Promise<string> {
  const path = configPath(io)
  await writePrivateFile(path, `${JSON.stringify(config, null, 2)}\n`)
  return path
}

/** The stored login, or undefined when there is none. Ignores the environment. */
export async function readStoredConfig(
  io: Pick<Io, 'env' | 'home'>,
): Promise<StoredConfig | undefined> {
  const path = configPath(io)
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new CliError(`${path} is not valid JSON; run embertrail login again`)
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('hub' in parsed) ||
    !('token' in parsed) ||
    typeof parsed.hub !== 'string' ||
    typeof parsed.token !== 'string'
  ) {
    throw new CliError(`${path} is not an embertrail config; run embertrail login again`)
  }
  return { hub: parsed.hub, token: parsed.token }
}

/** The Hub and Token a tool uses; either is undefined when nothing supplies it. */
export interface Target {
  hub: string | undefined
  token: string | undefined
}

const set = (value: string | undefined): string | undefined =>
  value === undefined || value === '' ? undefined : value

/**
 * Which Hub and which Token a tool uses. This is the one rule every tool shares (the CLI, the
 * Dashboard's dev proxy, `seed`):
 *
 * 1. `EMBERTRAIL_HUB` and `EMBERTRAIL_TOKEN` each override on their own (an empty value is unset).
 * 2. The stored login supplies what they leave out, except that a stored Token is used only for the
 *    Hub it was stored for: `EMBERTRAIL_HUB` naming another Hub gets no stored Token.
 * 3. With no Hub from either, `options.defaultHub` (none by default).
 *
 * The Hub is normalised (`normaliseHub`), so callers never trim it. The stored file is not read
 * when the environment already supplies both.
 */
export async function resolveTarget(
  io: Pick<Io, 'env' | 'home'>,
  options: { defaultHub?: string } = {},
): Promise<Target> {
  const hubEnv = set(io.env.EMBERTRAIL_HUB)
  const tokenEnv = set(io.env.EMBERTRAIL_TOKEN)
  const stored =
    hubEnv !== undefined && tokenEnv !== undefined ? undefined : await readStoredConfig(io)
  const hub = hubEnv ?? stored?.hub ?? options.defaultHub
  const normalised = hub === undefined ? undefined : normaliseHub(hub)
  const storedHub = stored === undefined ? undefined : normaliseHub(stored.hub)
  const token =
    tokenEnv ?? (stored !== undefined && storedHub === normalised ? stored.token : undefined)
  return { hub: normalised, token }
}

/**
 * The Hub and Token for a command, by `resolveTarget`'s rule. Undefined when either is missing,
 * which is how a command knows the user has not logged in.
 */
export async function readConfig(io: Pick<Io, 'env' | 'home'>): Promise<StoredConfig | undefined> {
  const { hub, token } = await resolveTarget(io)
  return hub === undefined || token === undefined ? undefined : { hub, token }
}

const trimSlashes = (url: string): string => url.replace(/\/+$/, '')

/** A Hub URL as stored: http or https, no trailing slash. */
export function normaliseHub(input: string): string {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new CliError(
      `"${input}" is not a URL; give the Hub's address, such as http://localhost:8787`,
    )
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new CliError(`"${input}" must start with http:// or https://`)
  }
  return trimSlashes(url.toString())
}

/** Is the Hub on this machine, where a plain-http Token stays off the network? */
export function isLocalHub(hub: string): boolean {
  const { hostname } = new URL(hub)
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}
