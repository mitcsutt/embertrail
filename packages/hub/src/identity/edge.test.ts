import {
  createLocalJWKSet,
  createRemoteJWKSet,
  customFetch,
  exportJWK,
  generateKeyPair,
  SignJWT,
} from 'jose'
import { beforeAll, describe, expect, it } from 'vitest'

import { edgeIdentityChecks } from '../contract/index'
import type { EdgeIdentityFixture } from '../contract/index'
import { fakeEdgeIdentity } from '../testing/pglite'
import { cloudflareAccess, noEdgeIdentity } from './edge'

const url = 'http://hub.test/api/v1/notes'
const plain = () => new Request(url)
const withHeader = (name: string, value: string) => new Request(url, { headers: { [name]: value } })
const access = (jwt: string) => withHeader('cf-access-jwt-assertion', jwt)

type KeyPair = Awaited<ReturnType<typeof generateKeyPair>>
type PrivateKey = KeyPair['privateKey']
type PublicKey = KeyPair['publicKey']

function runChecks(fixture: () => EdgeIdentityFixture) {
  it.each(edgeIdentityChecks)('$name', async (check) => {
    await expect(check.run(fixture())).resolves.toBeUndefined()
  })
}

describe('noEdgeIdentity', () => {
  runChecks(() => ({
    port: noEdgeIdentity(),
    absent: plain(),
    ignored: [access('anything'), withHeader('x-test-edge-identity', 'alice')],
  }))
})

describe('fakeEdgeIdentity', () => {
  runChecks(() => ({
    port: fakeEdgeIdentity({ alice: 'alice@example.com' }),
    absent: plain(),
    valid: { request: withHeader('x-test-edge-identity', 'alice'), email: 'alice@example.com' },
    invalid: [withHeader('x-test-edge-identity', 'mallory')],
    ignored: [access('anything')],
  }))
})

describe('cloudflareAccess', () => {
  const teamDomain = 'team.cloudflareaccess.com'
  const audience = 'aud-tag'
  let fixture: EdgeIdentityFixture

  beforeAll(async () => {
    const signing = await generateKeyPair('RS256')
    const stranger = await generateKeyPair('RS256')
    const jwk = { ...(await exportJWK(signing.publicKey)), kid: 'k1', alg: 'RS256' }
    const keys = createLocalJWKSet({ keys: [jwk] })
    const sign = (
      claims: Record<string, unknown>,
      options: { key?: PrivateKey; aud?: string; iss?: string; exp?: string } = {},
    ) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer(options.iss ?? `https://${teamDomain}`)
        .setAudience(options.aud ?? audience)
        .setIssuedAt()
        .setExpirationTime(options.exp ?? '5m')
        .sign(options.key ?? signing.privateKey)

    fixture = {
      port: cloudflareAccess({ teamDomain, audience, keys }),
      absent: plain(),
      valid: {
        request: access(await sign({ email: 'alice@example.com' })),
        email: 'alice@example.com',
      },
      invalid: [
        access('not-a-jwt'),
        access(await sign({ email: 'alice@example.com' }, { aud: 'another-app' })),
        access(
          await sign({ email: 'alice@example.com' }, { iss: 'https://other.cloudflareaccess.com' }),
        ),
        access(await sign({ email: 'alice@example.com' }, { exp: '-1m' })),
        access(await sign({ email: 'alice@example.com' }, { key: stranger.privateKey })),
      ],
      // A service token: valid, but names no User.
      unnamed: [
        access(await sign({ common_name: 'ci-bot' })),
        access(await sign({ common_name: 'ci-bot', email: '' })),
      ],
      ignored: [withHeader('x-test-edge-identity', 'alice')],
    }
  })

  runChecks(() => fixture)
})

describe('cloudflareAccess key rotation', () => {
  const teamDomain = 'team.cloudflareaccess.com'
  const audience = 'aud-tag'

  it('refetches the key set once for an unknown kid, then verifies', async () => {
    const first = await generateKeyPair('RS256')
    const second = await generateKeyPair('RS256')
    const jwk = async (key: PublicKey, kid: string) => ({
      ...(await exportJWK(key)),
      kid,
      alg: 'RS256',
    })
    // The team publishes only k1 at first, then rotates in k2.
    let published = [await jwk(first.publicKey, 'k1')]
    let fetches = 0
    const keys = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`), {
      cooldownDuration: 0,
      [customFetch]: () => {
        fetches += 1
        return Promise.resolve(Response.json({ keys: published }))
      },
    })
    const port = cloudflareAccess({ teamDomain, audience, keys })
    const sign = (kid: string, key: PrivateKey) =>
      new SignJWT({ email: 'alice@example.com' })
        .setProtectedHeader({ alg: 'RS256', kid })
        .setIssuer(`https://${teamDomain}`)
        .setAudience(audience)
        .setExpirationTime('5m')
        .sign(key)

    expect(await port.verify(access(await sign('k1', first.privateKey)))).toEqual({
      email: 'alice@example.com',
    })
    expect(fetches).toBe(1)
    // A cached key needs no refetch.
    await port.verify(access(await sign('k1', first.privateKey)))
    expect(fetches).toBe(1)

    published = [...published, await jwk(second.publicKey, 'k2')]
    expect(await port.verify(access(await sign('k2', second.privateKey)))).toEqual({
      email: 'alice@example.com',
    })
    expect(fetches).toBe(2)
  })
})
