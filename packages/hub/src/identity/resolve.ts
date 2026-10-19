import { HubError } from '../module/errors'
import type { Caller, Scope } from '../module/define'
import type { EdgeIdentityPort } from './edge'

/** A User as the Directory knows them. */
export interface Principal {
  userId: string
  scopes: readonly Scope[]
  /** Set for a Source-bound (ingest) Token. */
  sourceId?: string | undefined
}

/**
 * Where the core looks Users up. Core identity (#29) implements it over the `core` tables:
 * hashed Token lookup, and Edge Identity emails with allowlisted auto-provisioning.
 */
export interface Directory {
  /** The Token's User, or null when it is unknown, revoked or expired. */
  token(token: string): Promise<Principal | null>
  /**
   * The User an Edge Identity email names. With `provision`, creates one when the email is
   * allowlisted. Null when there is no such User (or it may not be created).
   */
  edgeUser(email: string, options: { provision: boolean }): Promise<Principal | null>
  /** Whether an Owner id is a User's or a Team's. Omitted: every Owner is a User (no Teams). */
  ownerKind?(ownerId: string): Promise<'user' | 'team'>
}

/** Knows nobody: every request is 401. The default until core identity (#29) lands. */
export const emptyDirectory: Directory = {
  token: () => Promise.resolve(null),
  edgeUser: () => Promise.resolve(null),
}

function bearer(request: Request): string | undefined {
  const header = request.headers.get('authorization')
  if (header === null) return undefined
  const match = /^Bearer\s+(\S+)$/i.exec(header)
  if (match?.[1] === undefined) throw HubError.unauthenticated('Malformed Authorization header')
  return match[1]
}

function toCaller(principal: Principal): Caller {
  return {
    userId: principal.userId,
    ownerId: principal.userId,
    sourceId: principal.sourceId,
    scopes: principal.scopes,
  }
}

/**
 * The core's resolution order (#26): a Token decides the User, and an Edge Identity naming
 * a different User is refused (403). With no Token, a verified email maps to a User, created
 * only when allowlisted (403 otherwise). Neither present: 401.
 */
export async function resolveCaller(
  request: Request,
  edgeIdentity: EdgeIdentityPort,
  directory: Directory,
): Promise<Caller> {
  const token = bearer(request)
  const edge = await edgeIdentity.verify(request)
  if (token !== undefined) {
    const principal = await directory.token(token)
    if (principal === null) throw HubError.unauthenticated('Unknown Token')
    if (edge !== null) {
      const edgeUser = await directory.edgeUser(edge.email, { provision: false })
      if (edgeUser?.userId !== principal.userId) throw HubError.identityConflict()
    }
    return toCaller(principal)
  }
  if (edge !== null) {
    const principal = await directory.edgeUser(edge.email, { provision: true })
    if (principal === null) throw HubError.forbidden('Edge Identity is not an allowed User')
    return toCaller(principal)
  }
  throw HubError.unauthenticated('No Token or Edge Identity')
}
