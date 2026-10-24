import { createClient } from '@mitcsutt/embertrail-client'
import type { EmbertrailClient } from '@mitcsutt/embertrail-client'

import type { Args, OptionSpec, PositionalSpec } from './args.ts'
import { readConfig } from './config.ts'
import type { StoredConfig } from './config.ts'
import { CliError } from './errors.ts'
import type { Io } from './io.ts'
import { printable } from './output.ts'

/** What a command runs with. */
export interface Context {
  io: Io
  /** `--json`: print machine-readable output. */
  json: boolean
  /** Prints `data` as JSON with `--json`, else `text`. */
  print(data: unknown, text: string): void
  /** The Hub and Token from `embertrail login`; fails when the user has not logged in. */
  login(): Promise<StoredConfig>
  /** A client for the logged-in Hub. */
  client(): Promise<EmbertrailClient>
}

export interface Command {
  /** Words that select it, such as `['admin', 'users', 'create']`. */
  path: readonly string[]
  summary: string
  /** A paragraph for the command's `--help`. */
  description?: string
  options?: Record<string, OptionSpec>
  positionals?: readonly PositionalSpec[]
  run(ctx: Context, args: Args): Promise<void>
}

/** A client for `hub` whose network failures read as a sentence, not a bare `fetch failed`. */
export function hubClient(io: Io, hub: string, token?: string): EmbertrailClient {
  return createClient({
    baseUrl: hub,
    ...(token === undefined ? {} : { token }),
    fetch: async (input, init) => {
      try {
        return await io.fetch(input, init)
      } catch (error) {
        throw unreachable(hub, error)
      }
    },
  })
}

export function unreachable(hub: string, error: unknown): CliError {
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error
  const reason = cause instanceof Error ? cause.message : String(cause)
  return new CliError(`Could not reach the Hub at ${hub}: ${reason}`)
}

export function makeContext(io: Io, json: boolean): Context {
  let config: Promise<StoredConfig> | undefined
  const login = () =>
    (config ??= readConfig(io).then((found) => {
      if (found === undefined) {
        throw new CliError('Not logged in; run embertrail login --hub <url> --token <token>')
      }
      return found
    }))
  return {
    io,
    json,
    print(data, text) {
      // Server text in `text` is already `printable`; this keeps any other line from driving the terminal.
      io.stdout(
        `${json ? JSON.stringify(data, null, 2) : text.split('\n').map(printable).join('\n')}\n`,
      )
    },
    login,
    async client() {
      const { hub, token } = await login()
      return hubClient(io, hub, token)
    },
  }
}
