// Where `pnpm dev` and `pnpm preview` send /api, and the Token they add. The browser never holds
// the Token: this proxy puts it on each request (#72 A3).

import { readConfig } from '@mitcsutt/embertrail-cli/config'
import type { Io } from '@mitcsutt/embertrail-cli/io'

export const defaultHub = 'http://localhost:8787'

export interface HubProxy {
  target: string
  /** The Authorization header to add, or none when there is no Token for `target`. */
  headers: Record<string, string>
}

/**
 * Whether a request came from a page on another origin. The proxy adds the Token, so it must refuse
 * these: a simple cross-site request needs no preflight and would otherwise be written as the user.
 */
export function isCrossOrigin(headers: Record<string, string | string[] | undefined>): boolean {
  const site = headers['sec-fetch-site']
  if (site !== undefined && site !== 'same-origin' && site !== 'none') return true
  const origin = headers.origin
  if (origin === undefined) return false
  try {
    return typeof origin !== 'string' || new URL(origin).host !== headers.host
  } catch {
    return true
  }
}

const trim = (url: string): string => url.replace(/\/+$/, '')

/**
 * The Hub is `EMBERTRAIL_HUB`, else the one `embertrail login` stored, else `defaultHub`. The Token is
 * `EMBERTRAIL_TOKEN`, else the stored one, but a stored Token goes only to the Hub it was stored for.
 */
export async function resolveHubProxy(io: Io): Promise<HubProxy> {
  const stored = await readConfig(io)
  const { EMBERTRAIL_HUB: hubEnv, EMBERTRAIL_TOKEN: tokenEnv } = io.env
  const target = trim(hubEnv === undefined || hubEnv === '' ? (stored?.hub ?? defaultHub) : hubEnv)
  const token =
    tokenEnv !== undefined && tokenEnv !== ''
      ? tokenEnv
      : stored !== undefined && trim(stored.hub) === target
        ? stored.token
        : undefined
  return { target, headers: token === undefined ? {} : { authorization: `Bearer ${token}` } }
}
