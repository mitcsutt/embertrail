import { describe, expect, it } from 'vitest'

import { HubError } from '../module/errors'
import { fakeEdgeIdentity } from '../testing/pglite'
import { resolveCaller } from './resolve'
import type { Directory, Principal } from './resolve'

const alice: Principal = { userId: 'alice', scopes: ['notes:read'] }
const bob: Principal = { userId: 'bob', scopes: ['notes:read'] }

// Tokens and edge users as core identity (#29) will hold them; provisioning only for the
// allowlisted domain, as ALLOWED_DOMAINS would.
const directory: Directory = {
  token: (token) => Promise.resolve({ 'alice-token': alice }[token] ?? null),
  edgeUser(email, { provision }) {
    if (email === 'alice@example.com') return Promise.resolve(alice)
    if (email === 'bob@example.com') return Promise.resolve(bob)
    if (provision && email.endsWith('@example.com')) {
      return Promise.resolve({ userId: email, scopes: [] })
    }
    return Promise.resolve(null)
  },
}

const edge = fakeEdgeIdentity({
  alice: 'alice@example.com',
  bob: 'bob@example.com',
  carol: 'carol@example.com',
  mallory: 'mallory@elsewhere.test',
})

function request(headers: Record<string, string>) {
  return new Request('http://hub.test/api/v1/notes', { headers })
}

const resolve = (headers: Record<string, string>) =>
  resolveCaller(request(headers), edge, directory)

async function problem(headers: Record<string, string>) {
  const error = await resolve(headers).catch((e: unknown) => e)
  if (!(error instanceof HubError)) throw new Error(`expected a HubError, got ${String(error)}`)
  return { status: error.status, slug: error.slug }
}

describe('caller resolution order', () => {
  it('Token only: the Token decides the User', async () => {
    await expect(resolve({ authorization: 'Bearer alice-token' })).resolves.toEqual({
      userId: 'alice',
      ownerId: 'alice',
      sourceId: undefined,
      scopes: ['notes:read'],
    })
  })

  it('Edge only: a verified email maps to its User', async () => {
    await expect(resolve({ 'x-test-edge-identity': 'bob' })).resolves.toMatchObject({
      userId: 'bob',
    })
  })

  it('Edge only: an allowlisted email is provisioned', async () => {
    await expect(resolve({ 'x-test-edge-identity': 'carol' })).resolves.toMatchObject({
      userId: 'carol@example.com',
    })
  })

  it('Edge only: an email outside the allowlist is 403', async () => {
    expect(await problem({ 'x-test-edge-identity': 'mallory' })).toEqual({
      status: 403,
      slug: 'forbidden',
    })
  })

  it('both, naming the same User: allowed', async () => {
    await expect(
      resolve({ authorization: 'Bearer alice-token', 'x-test-edge-identity': 'alice' }),
    ).resolves.toMatchObject({ userId: 'alice' })
  })

  it('both, naming different Users: 403 identity-conflict', async () => {
    expect(
      await problem({ authorization: 'Bearer alice-token', 'x-test-edge-identity': 'bob' }),
    ).toEqual({ status: 403, slug: 'identity-conflict' })
  })

  it('both, with an Edge email that is no User yet: 403 identity-conflict, nothing provisioned', async () => {
    expect(
      await problem({ authorization: 'Bearer alice-token', 'x-test-edge-identity': 'carol' }),
    ).toEqual({ status: 403, slug: 'identity-conflict' })
  })

  it('neither: 401', async () => {
    expect(await problem({})).toEqual({ status: 401, slug: 'unauthenticated' })
  })

  it('an unknown Token is 401', async () => {
    expect(await problem({ authorization: 'Bearer nobody' })).toEqual({
      status: 401,
      slug: 'unauthenticated',
    })
  })

  it('a malformed Authorization header is 401', async () => {
    expect(await problem({ authorization: 'Basic abc' })).toEqual({
      status: 401,
      slug: 'unauthenticated',
    })
  })
})
