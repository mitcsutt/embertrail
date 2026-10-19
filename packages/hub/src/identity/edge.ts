import { createRemoteJWKSet, errors, jwtVerify } from 'jose'
import type { JWTVerifyGetKey } from 'jose'

/** The verified identity an edge (such as Cloudflare Access) asserts. */
export interface EdgeIdentity {
  email: string
}

/**
 * The Edge Identity Port (#26): what sits in front of a deployment. Tokens are core logic,
 * not part of this Port.
 */
export interface EdgeIdentityPort {
  /**
   * Returns the identity the edge asserts, or null if none is present. Throws
   * `EdgeIdentityError` when an assertion is present but invalid.
   */
  verify(request: Request): Promise<EdgeIdentity | null>
}

/** An assertion was present but failed verification. The core answers 401. */
export class EdgeIdentityError extends Error {
  override readonly name = 'EdgeIdentityError'
}

/** No edge in front of the Hub: always null. The default on Docker. */
export function noEdgeIdentity(): EdgeIdentityPort {
  return { verify: () => Promise.resolve(null) }
}

export interface CloudflareAccessOptions {
  /** The Access team domain, such as `<team>.cloudflareaccess.com`. */
  teamDomain: string
  /** The Access application's audience (AUD) tag. */
  audience: string
  /** Overrides the team's remote key set, for tests. */
  keys?: JWTVerifyGetKey
}

/**
 * Verifies `Cf-Access-Jwt-Assertion` against the team's JWKS, which is cached and refreshed
 * when a token names an unknown `kid`.
 */
export function cloudflareAccess(options: CloudflareAccessOptions): EdgeIdentityPort {
  const issuer = `https://${options.teamDomain}`
  const keys = options.keys ?? createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`))
  return {
    async verify(request) {
      const assertion = request.headers.get('cf-access-jwt-assertion')
      if (assertion === null) return null
      let email: unknown
      try {
        const { payload } = await jwtVerify(assertion, keys, {
          issuer,
          audience: options.audience,
        })
        email = payload.email
      } catch (error) {
        if (error instanceof errors.JOSEError) {
          throw new EdgeIdentityError(`Cloudflare Access assertion rejected: ${error.code}`)
        }
        throw error
      }
      // Service tokens carry no email; they don't name a User.
      if (typeof email !== 'string' || email === '') {
        throw new EdgeIdentityError('Cloudflare Access assertion has no email')
      }
      return { email }
    },
  }
}
