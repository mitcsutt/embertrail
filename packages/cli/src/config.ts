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
export function configPath(io: Io): string {
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

/**
 * The Hub and Token to use: `EMBERTRAIL_HUB` and `EMBERTRAIL_TOKEN` when both are set (for CI and
 * containers), else the stored config. Undefined when the user has not logged in.
 */
export async function readConfig(io: Io): Promise<StoredConfig | undefined> {
  const { EMBERTRAIL_HUB: hub, EMBERTRAIL_TOKEN: token } = io.env
  if (hub !== undefined && hub !== '' && token !== undefined && token !== '') return { hub, token }
  const path = configPath(io)
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  const parsed: unknown = JSON.parse(text)
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
  return url.toString().replace(/\/+$/, '')
}

/** Is the Hub on this machine, where a plain-http Token stays off the network? */
export function isLocalHub(hub: string): boolean {
  const { hostname } = new URL(hub)
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}
