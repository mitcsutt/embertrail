import { HubError } from '../module/errors'
import type { Caller } from '../module/define'
import type { Principal, Resolver } from './directory'
import type { EdgeIdentityPort } from './edge'
import { parseToken } from './tokens'

/** The bearer credential on a request, if any. */
export function bearer(request: Request): string | undefined {
  const header = request.headers.get('authorization')
  if (header === null) return undefined
  const match = /^Bearer\s+(\S+)$/i.exec(header)
  if (match?.[1] === undefined) throw HubError.unauthenticated('Malformed Authorization header')
  return match[1]
}

/** `Embertrail-Owner: team:<id>` acts for a Team the caller edits (#27). */
const ownerHeader = /^team:([A-Za-z0-9_-]{1,64})$/

function toCaller(principal: Principal): Caller {
  return {
    userId: principal.userId,
    ownerId: principal.userId,
    sourceId: principal.sourceId,
    scopes: principal.scopes,
    expiresAt: principal.expiresAt,
  }
}

/** The User behind the request: its Token, else its Edge Identity. */
async function resolveUser(
  request: Request,
  edgeIdentity: EdgeIdentityPort,
  resolver: Resolver,
): Promise<Principal> {
  const token = bearer(request)
  // A malformed Token is refused before anything is looked up.
  const parsed = token === undefined ? undefined : parseToken(token)
  if (parsed === null) throw HubError.unauthenticated('Malformed Token')
  const edge = await edgeIdentity.verify(request)
  if (parsed !== undefined) {
    const principal = await resolver.token(parsed)
    if (principal === null) throw HubError.unauthenticated('Unknown Token')
    if (edge !== null) {
      const edgeUser = await resolver.edgeUser(edge.email, { provision: false })
      if (edgeUser?.userId !== principal.userId) throw HubError.identityConflict()
    }
    return principal
  }
  if (edge !== null) {
    const principal = await resolver.edgeUser(edge.email, { provision: true })
    if (principal === null) throw HubError.forbidden('Edge Identity is not an allowed User')
    return principal
  }
  throw HubError.unauthenticated('No Token or Edge Identity')
}

/**
 * The core's resolution order (#26, #29): a Token decides the User, and an Edge Identity
 * naming a different User is refused (403). With no Token, a verified email maps to a User,
 * created only when allowlisted (403 otherwise). Neither present: 401. Then
 * `Embertrail-Owner: team:<id>` makes a Team's editor act for the Team.
 */
export async function resolveCaller(
  request: Request,
  edgeIdentity: EdgeIdentityPort,
  resolver: Resolver,
): Promise<Caller> {
  const caller = toCaller(await resolveUser(request, edgeIdentity, resolver))
  const owner = request.headers.get('embertrail-owner')
  if (owner === null) return caller
  const teamId = ownerHeader.exec(owner)?.[1]
  if (teamId === undefined) {
    throw HubError.validation([{ pointer: '', message: 'Embertrail-Owner must be team:<id>' }])
  }
  // A Source's Signals always belong to the Source's User.
  if (caller.sourceId !== undefined) {
    throw HubError.forbidden('A Source-bound Token acts only for its own User')
  }
  if ((await resolver.teamRole(teamId, caller.userId)) !== 'editor') {
    throw HubError.forbidden(`Not an editor of Team ${teamId}`)
  }
  return { ...caller, ownerId: teamId }
}
