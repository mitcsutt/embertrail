import assert from 'node:assert/strict'

import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { probe } from '../testing/probe'
import { testHub } from '../testing/test-hub'
import type { TestClient, TestHub } from '../testing/test-hub'

const alpha = probe('alpha')
const bootstrapToken = 'test-bootstrap-secret-0123456789abcdef'

async function body<T = Record<string, unknown>>(response: Response | Promise<Response>) {
  return (await (await response).json()) as T
}

/** A problem response's status and `type` slug. */
async function problem(response: Response | Promise<Response>) {
  const answered = await response
  const { type } = await body<{ type: string }>(answered)
  return { status: answered.status, type: type.replace('urn:embertrail:problem:', '') }
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

interface Issued {
  token: string
  record: { id: string; kind: string; source_id: string | null; scopes: string[] }
}

const self = (id: string) => `/api/v1/self/${id}`

describe('self-management', () => {
  let t: TestHub

  beforeEach(async () => {
    t = await testHub({ modules: [alpha], config: { bootstrapToken } })
  })

  afterEach(async () => {
    const { errors } = t
    await t.close()
    assert.deepEqual(errors, [], 'the Hub answered with a 500')
  })

  const ids = async (client: TestClient, list: string) =>
    (await body<{ items: { id: string }[] }>(client.get(self(list)))).items.map((i) => i.id)

  it('the solo path: bootstrap, connect a laptop, send Signals, read them', async () => {
    const started = await t.anonymous.fetch('/api/v1/bootstrap', {
      method: 'POST',
      headers: bearer(bootstrapToken),
    })
    const { token } = await body<{ token: string }>(started)
    const me = (path: string, init: RequestInit = {}) =>
      t.anonymous.fetch(path, {
        ...init,
        headers: { ...bearer(token), 'content-type': 'application/json' },
      })

    const created = await me(self('sources'), {
      method: 'POST',
      body: JSON.stringify({ name: 'laptop' }),
    })
    expect(created.status).toBe(201)
    const { source, token: ingest } = await body<{ source: { id: string }; token: Issued }>(created)
    expect(ingest.record).toMatchObject({
      kind: 'ingest',
      source_id: source.id,
      scopes: ['alpha:write'],
    })

    const sent = await t.anonymous.fetch('/api/v1/alpha/signals', {
      method: 'POST',
      headers: { ...bearer(ingest.token), 'content-type': 'application/json' },
      body: JSON.stringify({ value: 7 }),
    })
    expect(sent.status).toBe(200)
    const read = await body<{ signals: { value: number }[] }>(me('/api/v1/alpha/signals'))
    expect(read.signals.map((s) => s.value)).toEqual([7])
    // No Team, Grant or allowlist anywhere on the way.
    expect(await t.sql(sql`select 1 from core.teams union all select 1 from core.grants`)).toEqual(
      [],
    )
  })

  describe('Sources', () => {
    it('creates, lists, renames and deletes your Sources', async () => {
      const alice = t.as('alice', ['self:manage', 'alpha:read', 'alpha:write'])
      const created = await body<{ source: { id: string }; token: Issued }>(
        alice.post(self('sources'), {
          name: 'laptop',
          scopes: ['alpha:write'],
          expires_at: '2999-01-01T00:00:00Z',
        }),
      )
      expect(created.token.record).toMatchObject({ scopes: ['alpha:write'], name: 'laptop' })
      const { id } = created.source

      const renamed = await alice.put(self(`sources/${id}`), { name: 'work laptop' })
      expect(await body(renamed)).toEqual({ id, owner_id: 'alice', name: 'work laptop' })
      expect(await body(alice.get(self('sources')))).toEqual({
        items: [{ id, owner_id: 'alice', name: 'work laptop' }],
      })

      await t.anonymous.fetch('/api/v1/alpha/signals', {
        method: 'POST',
        headers: { ...bearer(created.token.token), 'content-type': 'application/json' },
        body: JSON.stringify({ value: 1 }),
      })
      expect((await alice.delete(self(`sources/${id}`))).status).toBe(204)
      expect(await t.sql(sql`select 1 from alpha.signals where source_id = ${id}`)).toEqual([])
      expect(await t.sql(sql`select 1 from core.tokens where source_id = ${id}`)).toEqual([])
      expect(await ids(alice, 'sources')).toEqual([])
    })

    it('refuses a taken name (409) and a Scope the caller lacks (403), creating nothing', async () => {
      const alice = t.as('alice', ['self:manage', 'alpha:write'])
      await alice.post(self('sources'), { name: 'laptop' })
      expect(await problem(alice.post(self('sources'), { name: 'laptop' }))).toEqual({
        status: 409,
        type: 'conflict',
      })
      expect(
        await problem(alice.post(self('sources'), { name: 'desktop', scopes: ['sql:read'] })),
      ).toEqual({ status: 403, type: 'forbidden' })
      expect(
        await problem(alice.post(self('sources'), { name: 'desktop', scopes: ['nope:write'] })),
      ).toEqual({ status: 422, type: 'invalid' })
      expect(await t.sql(sql`select name from core.sources`)).toEqual([{ name: 'laptop' }])
    })

    it('refuses a Source with no ingest Scope to give it', async () => {
      const alice = t.as('alice', ['self:manage'])
      expect(await problem(alice.post(self('sources'), { name: 'laptop' }))).toEqual({
        status: 422,
        type: 'invalid',
      })
      expect(await t.sql(sql`select 1 from core.sources`)).toEqual([])
    })
  })

  describe('Tokens', () => {
    it('issues, lists and revokes your Tokens', async () => {
      const alice = t.as('alice', ['self:manage', 'alpha:read'])
      const issued = await alice.post(self('tokens'), {
        kind: 'read',
        scopes: ['alpha:read'],
        name: 'dashboard',
      })
      expect(issued.status).toBe(201)
      const { token, record } = await body<Issued>(issued)
      expect(record).toMatchObject({ kind: 'read', scopes: ['alpha:read'], name: 'dashboard' })
      const reader = (path: string) => t.anonymous.fetch(path, { headers: bearer(token) })
      expect((await reader('/api/v1/alpha/signals')).status).toBe(200)

      const listed = await body<{ items: { id: string; revoked_at: string | null }[] }>(
        alice.get(self('tokens')),
      )
      expect(listed.items).toHaveLength(2)
      expect(listed.items[1]).toMatchObject({ id: record.id, revoked_at: null })
      expect(JSON.stringify(listed)).not.toContain(token)

      expect((await alice.delete(self(`tokens/${record.id}`))).status).toBe(204)
      expect((await alice.delete(self(`tokens/${record.id}`))).status).toBe(204)
      expect((await reader('/api/v1/alpha/signals')).status).toBe(401)
      const after = await body<{ items: { revoked_at: string | null }[] }>(
        alice.get(self('tokens')),
      )
      expect(after.items[1]?.revoked_at).toEqual(expect.any(String))
    })

    it('issues an ingest Token for one of your Sources only', async () => {
      const alice = t.as('alice', ['self:manage', 'alpha:write'])
      await t.as('bob', ['alpha:write'], { sourceId: 'bob-laptop' }).get('/api/v1/alpha/whoami')
      const { source } = await body<{ source: { id: string } }>(
        alice.post(self('sources'), { name: 'laptop' }),
      )
      const issued = await alice.post(self('tokens'), {
        kind: 'ingest',
        scopes: ['alpha:write'],
        source_id: source.id,
      })
      expect(await body(issued)).toMatchObject({ record: { source_id: source.id } })
      expect(
        await problem(
          alice.post(self('tokens'), {
            kind: 'ingest',
            scopes: ['alpha:write'],
            source_id: 'bob-laptop',
          }),
        ),
      ).toEqual({ status: 404, type: 'not-found' })
      expect(
        await problem(alice.post(self('tokens'), { kind: 'ingest', scopes: ['alpha:write'] })),
      ).toEqual({ status: 422, type: 'invalid' })
      expect(
        await problem(
          alice.post(self('tokens'), {
            kind: 'read',
            scopes: ['alpha:write'],
            source_id: source.id,
          }),
        ),
      ).toEqual({ status: 422, type: 'invalid' })
    })

    it('never issues a Scope the caller lacks, admin included', async () => {
      const alice = t.as('alice', ['self:manage', 'alpha:read'])
      for (const scopes of [['alpha:write'], ['admin'], ['sql:read']]) {
        expect(await problem(alice.post(self('tokens'), { kind: 'management', scopes }))).toEqual({
          status: 403,
          type: 'forbidden',
        })
      }
      expect(await t.sql(sql`select 1 from core.tokens where user_id = 'alice'`)).toHaveLength(1)
    })

    it('refuses an expiry in the past (422) and a malformed one (400)', async () => {
      const alice = t.as('alice', ['self:manage', 'alpha:read'])
      const issue = (expiresAt: string) =>
        alice.post(self('tokens'), { kind: 'read', scopes: ['alpha:read'], expires_at: expiresAt })
      expect(await problem(issue('2000-01-01T00:00:00Z'))).toEqual({
        status: 422,
        type: 'invalid',
      })
      expect(await problem(issue('tomorrow'))).toEqual({ status: 400, type: 'validation' })
      expect((await issue('2999-01-01T00:00:00+02:00')).status).toBe(201)
    })
  })

  describe('Accounts', () => {
    it('lists your Accounts and labels them', async () => {
      const laptop = t.as('alice', ['alpha:write'], { sourceId: 'laptop' })
      await laptop.post('/api/v1/alpha/signals', {
        value: 1,
        attributes: { 'user.email': 'alice@work.example' },
      })
      const alice = t.as('alice', ['self:manage'])
      const { items } = await body<{ items: { id: string; label: string }[] }>(
        alice.get(self('accounts')),
      )
      expect(items).toEqual([
        {
          id: items[0]?.id,
          label: 'work.example',
          labelled: false,
          organization_id: null,
          account_uuid: null,
          email: 'alice@work.example',
          source_id: null,
        },
      ])
      const id = items[0]?.id ?? ''

      const labelled = await alice.put(self(`accounts/${id}`), { label: 'Work' })
      expect(await body(labelled)).toMatchObject({ id, label: 'Work', labelled: true })
      const reset = await alice.put(self(`accounts/${id}`), { label: null })
      expect(await body(reset)).toMatchObject({ id, label: 'work.example', labelled: false })
    })
  })

  describe('Grants', () => {
    it('grants a User or a Team read access to one Account in one Module, and revokes it', async () => {
      await t
        .as('alice', ['alpha:write'], { sourceId: 'laptop' })
        .post('/api/v1/alpha/signals', { value: 5 })
      const alice = t.as('alice', ['self:manage'])
      const [account] = await ids(alice, 'accounts')
      const bob = t.as('bob', ['alpha:read'])
      await t.team('crew', { members: ['carol'] })
      const carol = t.as('carol', ['alpha:read'])
      const visible = async (client: TestClient) =>
        (await body<{ signals: unknown[] }>(client.get('/api/v1/alpha/signals'))).signals.length

      const toBob = await alice.post(self('grants'), {
        module: 'alpha',
        account_id: account,
        user_id: 'bob',
      })
      expect(toBob.status).toBe(201)
      const grant = await body<{ id: string }>(toBob)
      expect(grant).toEqual({
        id: grant.id,
        module: 'alpha',
        account_id: account,
        user_id: 'bob',
        team_id: null,
      })
      await alice.post(self('grants'), { module: 'alpha', account_id: account, team_id: 'crew' })
      expect(await visible(bob)).toBe(1)
      expect(await visible(carol)).toBe(1)
      expect(await ids(alice, 'grants')).toHaveLength(2)

      expect((await alice.delete(self(`grants/${grant.id}`))).status).toBe(204)
      expect(await visible(bob)).toBe(0)
      expect(await visible(carol)).toBe(1)
    })

    it('refuses an unknown Module or grantee, and a Grant to both or neither', async () => {
      await t
        .as('alice', ['alpha:write'], { sourceId: 'laptop' })
        .post('/api/v1/alpha/signals', { value: 5 })
      const alice = t.as('alice', ['self:manage'])
      const [account] = await ids(alice, 'accounts')
      await t.user('bob')
      await t.team('crew', {})
      const grant = (input: Record<string, unknown>) =>
        problem(alice.post(self('grants'), { module: 'alpha', account_id: account, ...input }))
      expect(await grant({ module: 'beta', user_id: 'bob' })).toEqual({
        status: 422,
        type: 'invalid',
      })
      expect(await grant({ user_id: 'nobody' })).toEqual({ status: 404, type: 'not-found' })
      expect(await grant({ user_id: 'bob', team_id: 'crew' })).toEqual({
        status: 422,
        type: 'invalid',
      })
      expect(await grant({})).toEqual({ status: 422, type: 'invalid' })
      await alice.post(self('grants'), { module: 'alpha', account_id: account, user_id: 'bob' })
      expect(await grant({ user_id: 'bob' })).toEqual({ status: 409, type: 'conflict' })
    })
  })

  describe('isolation between Users', () => {
    it('a User with self:manage cannot see or change another User’s records', async () => {
      // Bob has a Source, Signals with an Account, a spare Token and a Grant.
      const bobLaptop = t.as('bob', ['alpha:write'], { sourceId: 'bob-laptop' })
      await bobLaptop.post('/api/v1/alpha/signals', { value: 1 })
      const bob = t.as('bob', ['self:manage', 'alpha:read'])
      const [bobAccount] = await ids(bob, 'accounts')
      await t.user('carol')
      await bob.post(self('grants'), { module: 'alpha', account_id: bobAccount, user_id: 'carol' })
      const before = {
        sources: await body(bob.get(self('sources'))),
        tokens: await body(bob.get(self('tokens'))),
        accounts: await body(bob.get(self('accounts'))),
        grants: await body(bob.get(self('grants'))),
      }
      const [bobToken] = await ids(bob, 'tokens')
      const [bobGrant] = await ids(bob, 'grants')

      const alice = t.as('alice', ['self:manage', 'alpha:read', 'alpha:write'])
      // Alice sees only her own (empty) lists...
      for (const list of ['sources', 'accounts', 'grants']) {
        expect(await ids(alice, list)).toEqual([])
      }
      expect(await ids(alice, 'tokens')).toHaveLength(1)
      // ...and every attempt on Bob's ids looks like an id that doesn't exist.
      const attempts = [
        alice.put(self('sources/bob-laptop'), { name: 'mine now' }),
        alice.delete(self('sources/bob-laptop')),
        alice.delete(self(`tokens/${bobToken ?? ''}`)),
        alice.put(self(`accounts/${bobAccount ?? ''}`), { label: 'mine now' }),
        alice.post(self('grants'), { module: 'alpha', account_id: bobAccount, user_id: 'alice' }),
        alice.delete(self(`grants/${bobGrant ?? ''}`)),
        alice.post(self('tokens'), {
          kind: 'ingest',
          scopes: ['alpha:write'],
          source_id: 'bob-laptop',
        }),
      ]
      for (const attempt of attempts) {
        expect(await problem(attempt)).toEqual({ status: 404, type: 'not-found' })
      }

      expect({
        sources: await body(bob.get(self('sources'))),
        tokens: await body(bob.get(self('tokens'))),
        accounts: await body(bob.get(self('accounts'))),
        grants: await body(bob.get(self('grants'))),
      }).toEqual(before)
      expect((await bobLaptop.post('/api/v1/alpha/signals', { value: 2 })).status).toBe(200)
      // Nor can Alice export Bob's data: an export is always the caller's own.
      const exported = await alice.get(self('export/alpha'))
      expect(await exported.text()).toBe('')
    })
  })

  describe('export', () => {
    it('streams your rows in one Module as JSON Lines', async () => {
      const laptop = t.as('alice', ['alpha:write'], { sourceId: 'laptop' })
      await laptop.post('/api/v1/alpha/signals', { value: 1 })
      await laptop.post('/api/v1/alpha/signals', { value: 2 })
      await t.as('alice', ['alpha:write']).post('/api/v1/alpha/notes', { note: 'n' })
      const alice = t.as('alice', ['self:manage'])

      const response = await alice.get(self('export/alpha'))

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('application/jsonl; charset=utf-8')
      const lines = (await response.text()).split('\n').filter(Boolean)
      expect(lines.map((line) => (JSON.parse(line) as { table: string }).table)).toEqual([
        'signals',
        'signals',
        'notes',
      ])
      expect(await problem(alice.get(self('export/beta')))).toEqual({
        status: 404,
        type: 'not-found',
      })
    })
  })
})
