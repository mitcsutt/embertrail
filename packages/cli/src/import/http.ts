// Reading the source stack's HTTP APIs (Prometheus, Loki) with the CLI's `fetch`.

import { CliError } from '../errors.ts'
import type { Io } from '../io.ts'
import { printable } from '../output.ts'

/** A source API: its base URL without credentials, and the headers that carry them. */
export interface Endpoint {
  io: Io
  /** For messages: the URL as given, without any user name or password. */
  name: string
  base: string
  headers: Record<string, string>
}

/**
 * An endpoint for `input`. A user name and password in the URL (`https://user:pass@host`) are
 * sent as Basic auth, since `fetch` refuses a URL that holds them.
 */
export function endpoint(io: Io, what: string, input: string): Endpoint {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new CliError(`--${what} "${input}" is not a URL`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new CliError(`--${what} must start with http:// or https://`)
  }
  const headers: Record<string, string> = {}
  if (url.username !== '' || url.password !== '') {
    const pair = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`
    headers.authorization = `Basic ${Buffer.from(pair).toString('base64')}`
    url.username = ''
    url.password = ''
  }
  const base = url.toString().replace(/\/+$/, '')
  return { io, name: base, base, headers }
}

/** GETs `path` with `query` and returns the parsed JSON, or fails with what the API said. */
export async function getJson(
  { io, name, base, headers }: Endpoint,
  path: string,
  query: Record<string, string>,
): Promise<unknown> {
  const url = `${base}${path}?${new URLSearchParams(query).toString()}`
  let response: Response
  try {
    response = await io.fetch(url, { headers })
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error
    throw new CliError(
      `Could not reach ${name}: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
  const text = await response.text()
  if (!response.ok) {
    throw new CliError(
      `${name}${path} answered ${String(response.status)}: ${printable(text.slice(0, 300))}`,
    )
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new CliError(`${name}${path} did not answer JSON`)
  }
}
