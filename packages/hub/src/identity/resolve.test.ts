import { sql } from 'drizzle-orm'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { fakeEdgeIdentity, pgliteDb } from '../testing/pglite'
import { probe } from '../testing/probe'
import { testHub } from '../testing/test-hub'
import type { TestHub } from '../testing/test-hub'
import { cloudflareAccess } from './edge'

const alpha = probe('alpha')
const read = ['alpha:read'] as const
const manage = ['self:manage', 'alpha:write'] as const

// Edge assertions as Cloudflare Access would make them; only example.com may sign up.
const edge = fakeEdgeIdentity({
  alice: 'alice@example.com',
  bob: 'bob@example.com',
  carol: 'Carol@Example.com',
  mallory: 'mallory@elsewhere.test',
})

async function body(response: Response) {
  return (await response.json()) as Record<string, unknown>
}

describe('caller resolution order', () => {
  let t: TestHub
  let now = new Date('2026-10-19T09:00:00Z')

  beforeEach(async () => {
    now = new Date('2026-10-19T09:00:00Z')
    t = await testHub({
      modules: [alpha],
      edgeIdentity: edge,
      config: { allowedDomains: ['example.com'] },
      clock: () => now,
    })
    await t.user('alice', { email: 'alice@example.com' })
    await t.user('bob', { email: 'bob@example.com' })
  })

  afterEach(async () => {
    await t.close()
  })

  const whoami = (headers: Record<string, string>, client = t.anonymous) =>
    client.fetch('/api/v1/alpha/whoami', { headers })

  async function problem(response: Response) {
    const { type, status } = await body(response)
    return { type, status }
  }

  it('Token only: the Token decides the User', async () => {
    const response = await whoami({}, t.as('alice', read))
    expect(response.status).toBe(200)
    expect(await body(response)).toEqual({
      userId: 'alice',
      ownerId: 'alice',
      sourceId: null,
      scopes: ['alpha:read'],
    })
  })

  it('Edge only: a verified email maps to its User, with every Scope but admin', async () => {
    const response = await whoami({ 'x-test-edge-identity': 'bob' })
    expect(response.status).toBe(200)
    expect(await body(response)).toMatchObject({
      userId: 'bob',
      scopes: ['alpha:read', 'alpha:write', 'self:manage', 'sql:read'],
    })
  })

  it('Edge only: an allowlisted email becomes a User on first sight, once', async () => {
    const first = await body(await whoami({ 'x-test-edge-identity': 'carol' }))
    const again = await body(await whoami({ 'x-test-edge-identity': 'carol' }))
    expect(again.userId).toBe(first.userId)
    expect(
      await t.sql(sql`select email, admin from core.users where id = ${String(first.userId)}`),
    ).toEqual([{ email: 'carol@example.com', admin: false }])
  })

  it('Edge only: an email outside the allowlist is 403 and creates no User', async () => {
    expect(await problem(await whoami({ 'x-test-edge-identity': 'mallory' }))).toEqual({
      type: 'urn:embertrail:problem:forbidden',
      status: 403,
    })
    expect(await t.sql(sql`select id from core.users where email like 'mallory%'`)).toEqual([])
  })

  it('Edge only: an invalid assertion is 401', async () => {
    expect(await problem(await whoami({ 'x-test-edge-identity': 'forged' }))).toEqual({
      type: 'urn:embertrail:problem:unauthenticated',
      status: 401,
    })
  })

  it('both, naming the same User: the Token’s Scopes apply', async () => {
    const response = await whoami({ 'x-test-edge-identity': 'alice' }, t.as('alice', read))
    expect(response.status).toBe(200)
    expect(await body(response)).toMatchObject({ userId: 'alice', scopes: ['alpha:read'] })
  })

  it('both, naming different Users: 403 identity-conflict', async () => {
    expect(
      await problem(await whoami({ 'x-test-edge-identity': 'bob' }, t.as('alice', read))),
    ).toEqual({ type: 'urn:embertrail:problem:identity-conflict', status: 403 })
  })

  it('both, with an allowlisted Edge email that is no User yet: 403, nothing created', async () => {
    expect(
      await problem(await whoami({ 'x-test-edge-identity': 'carol' }, t.as('alice', read))),
    ).toEqual({ type: 'urn:embertrail:problem:identity-conflict', status: 403 })
    expect(await t.sql(sql`select id from core.users where email like 'carol%'`)).toEqual([])
  })

  it('neither: 401', async () => {
    expect(await problem(await whoami({}))).toEqual({
      type: 'urn:embertrail:problem:unauthenticated',
      status: 401,
    })
  })

  it('a malformed Token is 401 before anything is looked up', async () => {
    let lookups = 0
    const db = pgliteDb()
    const counted = await testHub({
      modules: [alpha],
      db: {
        ...db,
        privileged: (fn) => {
          lookups += 1
          return db.privileged(fn)
        },
      },
    })
    try {
      const before = lookups
      for (const token of [
        'nope',
        'et_short_secret',
        `et_${'A'.repeat(16)}_${'b'.repeat(40)}`,
        `et_${'a'.repeat(16)}_${'b'.repeat(39)}`,
        `et_${'a'.repeat(16)}_${'b'.repeat(40)}x`,
        `xx_${'a'.repeat(16)}_${'b'.repeat(40)}`,
      ]) {
        const response = await whoami({ authorization: `Bearer ${token}` }, counted.anonymous)
        expect(await body(response)).toMatchObject({ status: 401, detail: 'Malformed Token' })
      }
      expect(lookups).toBe(before)
      // A well-formed but unknown Token is looked up, and still 401.
      const unknown = `et_${'a'.repeat(16)}_${'b'.repeat(40)}`
      const response = await whoami({ authorization: `Bearer ${unknown}` }, counted.anonymous)
      expect(await body(response)).toMatchObject({ status: 401, detail: 'Unknown Token' })
      expect(lookups).toBe(before + 1)
    } finally {
      await counted.close()
    }
  })

  it('a Token with the right id but the wrong secret is 401', async () => {
    const { token } = await t.hub.directory.issueToken('alice', { kind: 'read', scopes: read })
    const wrong = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`
    const response = await whoami({ authorization: `Bearer ${wrong}` })
    expect(await body(response)).toMatchObject({ status: 401, detail: 'Unknown Token' })
    expect((await whoami({ authorization: `Bearer ${token}` })).status).toBe(200)
  })

  it('a revoked Token is 401', async () => {
    const issued = await t.hub.directory.issueToken('alice', { kind: 'read', scopes: read })
    const headers = { authorization: `Bearer ${issued.token}` }
    expect((await whoami(headers)).status).toBe(200)
    await t.hub.directory.revokeToken(issued.record.id)
    expect((await whoami(headers)).status).toBe(401)
  })

  it('a Token expires when its expiry passes, and not before', async () => {
    const issued = await t.hub.directory.issueToken('alice', {
      kind: 'read',
      scopes: read,
      expiresAt: new Date('2026-10-20T00:00:00Z'),
    })
    const headers = { authorization: `Bearer ${issued.token}` }
    expect((await whoami(headers)).status).toBe(200)
    now = new Date('2026-10-20T00:00:00Z')
    expect((await whoami(headers)).status).toBe(401)
  })

  it('a malformed Authorization header is 401', async () => {
    expect(await problem(await whoami({ authorization: 'Basic abc' }))).toEqual({
      type: 'urn:embertrail:problem:unauthenticated',
      status: 401,
    })
  })
})

describe('browser requests by Edge Identity', () => {
  let t: TestHub

  beforeEach(async () => {
    t = await testHub({ modules: [alpha], edgeIdentity: edge })
    await t.user('alice', { email: 'alice@example.com' })
  })

  afterEach(async () => {
    await t.close()
  })

  let created = 0
  const json = { 'content-type': 'application/json' }
  const asAlice = { 'x-test-edge-identity': 'alice' }
  const createSource = (headers: Record<string, string>, client = t.anonymous) =>
    client.fetch('/api/v1/self/sources', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: `laptop-${(created += 1)}` }),
    })
  const sources = () => t.sql<{ id: string }>(sql`select id from core.sources`)

  it('a same-origin JSON POST succeeds', async () => {
    const response = await createSource({
      ...asAlice,
      ...json,
      origin: 'http://hub.test',
      'sec-fetch-site': 'same-origin',
    })
    expect(response.status).toBe(201)
    expect(await sources()).toHaveLength(1)
  })

  it('a cross-site text/plain POST is 403 and writes nothing', async () => {
    const response = await createSource({
      ...asAlice,
      'content-type': 'text/plain',
      origin: 'https://evil.test',
      'sec-fetch-site': 'cross-site',
    })
    expect(response.status).toBe(403)
    expect(await sources()).toEqual([])
  })

  it('a cross-site request is refused whatever its Content-Type', async () => {
    const response = await createSource({ ...asAlice, ...json, 'sec-fetch-site': 'same-site' })
    expect(response.status).toBe(403)
    expect(await sources()).toEqual([])
  })

  it('a cross-site GET is 403', async () => {
    const response = await t.anonymous.fetch('/api/v1/alpha/whoami', {
      headers: { ...asAlice, 'sec-fetch-site': 'cross-site' },
    })
    expect(response.status).toBe(403)
  })

  it('an Origin on another host is refused, and so is Origin: null', async () => {
    for (const origin of ['https://evil.test', 'http://hub.test:81', 'null']) {
      const response = await t.anonymous.fetch('/api/v1/alpha/whoami', {
        headers: { ...asAlice, origin },
      })
      expect(response.status, origin).toBe(403)
    }
  })

  it('a navigation (Sec-Fetch-Site: none) and a request without Fetch Metadata are allowed', async () => {
    for (const headers of [{ ...asAlice, 'sec-fetch-site': 'none' }, asAlice]) {
      expect((await t.anonymous.fetch('/api/v1/alpha/whoami', { headers })).status).toBe(200)
    }
  })

  it('a body needs a JSON Content-Type, matched case-insensitively and ignoring parameters', async () => {
    for (const type of [undefined, 'text/plain', 'application/x-www-form-urlencoded']) {
      const headers: Record<string, string> =
        type === undefined ? asAlice : { ...asAlice, 'content-type': type }
      expect((await createSource(headers)).status, String(type)).toBe(403)
    }
    expect(await sources()).toEqual([])
    const accepted = ['Application/JSON; charset=utf-8', 'application/problem+json']
    for (const type of accepted) {
      const response = await createSource({ ...asAlice, 'content-type': type })
      expect(response.status, type).toBe(201)
    }
  })

  it('a request without a body needs no Content-Type', async () => {
    const response = await t.anonymous.fetch('/api/v1/self/sources', { headers: asAlice })
    expect(response.status).toBe(200)
  })

  it('a Token caller is unaffected by the same cross-site headers', async () => {
    const response = await createSource(
      {
        'content-type': 'text/plain',
        origin: 'https://evil.test',
        'sec-fetch-site': 'cross-site',
      },
      t.as('alice', manage),
    )
    expect(response.status).toBe(201)
  })

  it('a Token beside an Edge Identity is a Token caller, so the guard does not apply', async () => {
    const response = await createSource(
      { ...asAlice, 'content-type': 'text/plain', 'sec-fetch-site': 'cross-site' },
      t.as('alice', manage),
    )
    expect(response.status).toBe(201)
  })
})

describe('an Access service token', () => {
  const teamDomain = 'team.cloudflareaccess.com'
  const audience = 'aud-tag'
  let t: TestHub
  let serviceToken: string

  beforeEach(async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256')
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }
    serviceToken = await new SignJWT({ common_name: 'ci-bot' })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(`https://${teamDomain}`)
      .setAudience(audience)
      .setExpirationTime('5m')
      .sign(privateKey)
    t = await testHub({
      modules: [alpha],
      edgeIdentity: cloudflareAccess({
        teamDomain,
        audience,
        keys: createLocalJWKSet({ keys: [jwk] }),
      }),
    })
    await t.user('alice', { email: 'alice@example.com' })
  })

  afterEach(async () => {
    await t.close()
  })

  const whoami = (client: TestHub['anonymous']) =>
    client.fetch('/api/v1/alpha/whoami', { headers: { 'cf-access-jwt-assertion': serviceToken } })

  it('with a valid Token: the Token’s User', async () => {
    const response = await whoami(t.as('alice', read))
    expect(response.status).toBe(200)
    expect(await body(response)).toMatchObject({ userId: 'alice', scopes: ['alpha:read'] })
  })

  it('alone: 401, since it names no User', async () => {
    const response = await whoami(t.anonymous)
    expect(response.status).toBe(401)
    expect(await body(response)).toMatchObject({ type: 'urn:embertrail:problem:unauthenticated' })
  })
})
