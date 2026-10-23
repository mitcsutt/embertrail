// Which Hub a development script talks to, and with which Token: the rule the `embertrail` CLI
// uses (docs/cli.md), so `pnpm seed` works after `embertrail login` with nothing else to set.
// Plain Node with explicit `.ts` imports, so a script and the Vite config can both import it.

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface HubConfig {
  /** The Hub's URL without a trailing slash. */
  hub: string
  token: string
}

export interface Environment {
  env: Record<string, string | undefined>
  home: string
  /** The file's text, or undefined when there is no such file. */
  read(path: string): string | undefined
}

const nodeEnvironment = (): Environment => ({
  env: process.env,
  home: homedir(),
  read(path) {
    try {
      return readFileSync(path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  },
})

/** `$EMBERTRAIL_CONFIG_DIR/config.json`, else `$XDG_CONFIG_HOME/embertrail/`, else `~/.config/embertrail/`. */
export function configPath({ env, home }: Pick<Environment, 'env' | 'home'>): string {
  const dir =
    env.EMBERTRAIL_CONFIG_DIR ?? join(env.XDG_CONFIG_HOME ?? join(home, '.config'), 'embertrail')
  return join(dir, 'config.json')
}

/**
 * `EMBERTRAIL_HUB` and `EMBERTRAIL_TOKEN` when both are set, else what `embertrail login` stored.
 * Throws a message that says what to run when neither is there.
 */
export function resolveHubConfig(environment: Environment = nodeEnvironment()): HubConfig {
  const { EMBERTRAIL_HUB: hub, EMBERTRAIL_TOKEN: token } = environment.env
  if (hub !== undefined && hub !== '' && token !== undefined && token !== '') {
    return { hub: hub.replace(/\/+$/, ''), token }
  }
  const path = configPath(environment)
  const text = environment.read(path)
  if (text === undefined) {
    throw new Error(
      `No Hub to talk to: run \`embertrail login --hub <url> --token <token>\`, or set EMBERTRAIL_HUB and EMBERTRAIL_TOKEN (looked for ${path}).`,
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`${path} is not valid JSON; run \`embertrail login\` again.`)
  }
  const stored = parsed as Partial<Record<'hub' | 'token', unknown>> | null
  if (typeof stored?.hub !== 'string' || typeof stored.token !== 'string') {
    throw new Error(`${path} is not an embertrail config; run \`embertrail login\` again.`)
  }
  return { hub: stored.hub.replace(/\/+$/, ''), token: stored.token }
}
