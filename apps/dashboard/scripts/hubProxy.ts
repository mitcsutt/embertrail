// Where `pnpm dev` and `pnpm preview` send /api, and the Token they add. The browser never holds
// the Token: this proxy puts it on each request (#72 A3).

import { resolveTarget } from '@mitcsutt/embertrail-cli/config'
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
 * The Hub applies the same rule to Edge-identified callers (`assertSameOriginEdgeRequest` in
 * `packages/hub/src/identity/resolve.ts`); keep the two the same.
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

/** The Hub and Token by the shared rule (`resolveTarget`), with `defaultHub` when no Hub is set. */
export async function resolveHubProxy(io: Io): Promise<HubProxy> {
  const { hub, token } = await resolveTarget(io, { defaultHub })
  return {
    // `defaultHub` guarantees a Hub.
    target: hub ?? defaultHub,
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  }
}
