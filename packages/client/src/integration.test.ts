import assert from 'node:assert/strict'

import { hubModules } from '@mitcsutt/embertrail-modules'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { seedSession } from '../test/seed.ts'
import { clientFor, operationIds, recordCalls, testHub, type TestHub } from '../test/test-hub.ts'

import { isProblemError, items, ProblemError, type EmbertrailClient } from './index.ts'

// Every operation, through the real client, against the real Hub on PGLite.
const scopes = ['otel:read', 'otel:write', 'sql:read', 'store:read', 'store:write'] as const
const window = { from: '2026-10-01T00:00:00Z', to: '2026-12-01T00:00:00Z', tz: 'UTC' }
const sessionId = '6f1c2b9e-0000-4000-8000-000000000001'

let t: TestHub
let alice: EmbertrailClient
let called: Set<string>

beforeAll(async () => {
  t = await testHub({ modules: hubModules, clock: () => new Date('2026-10-19T09:00:00Z') })
  ;({ client: alice, called } = recordCalls(await clientFor(t, 'alice', scopes)))
  await seedSession(t, 'alice', {
    sessionId,
    start: new Date('2026-10-12T09:00:00Z'),
  })
})

afterAll(async () => {
  await t.close()
  assert.deepEqual(t.errors, [], 'the Hub answered with a 500')
})

/** The problem a call fails with. */
async function problem(call: Promise<unknown>): Promise<ProblemError> {
  const error = await call.then(
    () => undefined,
    (e: unknown) => e,
  )
  if (!(error instanceof ProblemError)) throw new Error(`Not a ProblemError: ${String(error)}`)
  return error
}

describe('the Query API', () => {
  it('queryMetrics aggregates a Metric', async () => {
    const result = await alice.queryMetrics({
      body: { metric: 'claude_code.session.count', aggregation: 'sum', ...window },
    })
    expect(result.rows).toEqual([{ group: {}, value: 1 }])
    expect(result.meta.tz).toBe('UTC')
  })

  it('queryEvents lists Events and aggregates them', async () => {
    const list = await alice.queryEvents({ body: { mode: 'list', ...window, limit: 2 } })
    if (!('items' in list)) throw new Error('Expected an event list')
    expect(list.items).toHaveLength(2)
    expect(typeof list.next_cursor).toBe('string')

    const count = await alice.queryEvents({
      body: { mode: 'aggregate', ...window, aggregation: { fn: 'count' } },
    })
    if (!('rows' in count)) throw new Error('Expected aggregate rows')
    expect(count.rows[0]?.value).toBeGreaterThan(2)
  })

  it('listSessions, getSession and putSessionLabels read and label a Session', async () => {
    const listed = await alice.listSessions({ query: { from: window.from, to: window.to } })
    expect(listed.items.map((s) => s.id)).toEqual([sessionId])

    const labels = { ticket: 'ABC-123', 'embertrail.group.id': 'batch-1' }
    await expect(
      alice.putSessionLabels({ path: { session_id: sessionId }, body: { labels } }),
    ).resolves.toEqual({ session_id: sessionId, labels })

    const session = await alice.getSession({ path: { session_id: sessionId } })
    expect(session).toMatchObject({ id: sessionId, labels, group: { id: 'batch-1' }, children: [] })

    const labelled = await alice.listSessions({ query: { label: ['ticket=ABC-123'] } })
    expect(labelled.items.map((s) => s.id)).toEqual([sessionId])
  })

  it('getInventory lists what the caller can see', async () => {
    const inventory = await alice.getInventory()
    expect(inventory.owners).toContainEqual({ id: 'alice', kind: 'user', name: 'alice' })
    expect(inventory.services).toContain('claude-code')
  })

  it('runSql runs a read-only statement with parameters', async () => {
    const result = await alice.runSql({
      body: { sql: 'select $1::int + 1 as answer', params: [41] },
    })
    expect(result).toEqual({
      columns: [{ name: 'answer', type: 'int4' }],
      rows: [[42]],
      truncated: false,
    })
  })

  it('getOpenApi serves the Hub’s document', async () => {
    const document = (await alice.getOpenApi()) as { openapi: string; paths: object }
    expect(document.openapi).toMatch(/^3\.1/)
    expect(Object.keys(document.paths)).toContain('/api/v1/store/{namespace}/{id}')
  })

  it('pages walks a cursor through every Session', async () => {
    const session = new Date('2026-10-13T09:00:00Z')
    for (const [index, id] of ['a', 'b'].entries()) {
      await seedSession(t, 'alice', {
        sessionId: `${sessionId.slice(0, -1)}${id}`,
        start: new Date(session.getTime() + index * 3_600_000),
      })
    }
    const seen = []
    for await (const s of items((cursor) =>
      alice.listSessions({ query: { limit: 1, ...(cursor === undefined ? {} : { cursor }) } }),
    )) {
      seen.push(s.id)
    }
    expect(seen).toHaveLength(3)
    expect(new Set(seen).size).toBe(3)
  })
})

describe('the store', () => {
  const ns = 'notes'

  it('creates, reads, replaces, lists and deletes a document', async () => {
    const created = await alice.putStoreDocument({
      path: { namespace: ns, id: 'first' },
      header: { 'If-None-Match': '*' },
      body: { data: { title: 'Groceries' } },
    })
    expect(created.data).toMatchObject({
      namespace: ns,
      id: 'first',
      owner: { kind: 'user', id: 'alice' },
      version: 1,
      data: { title: 'Groceries' },
    })
    const etag = created.headers.ETag
    expect(etag).toMatch(/^".+"$/)

    const read = await alice.getStoreDocument({ path: { namespace: ns, id: 'first' } })
    expect(read.data).toEqual(created.data)
    expect(read.headers.ETag).toBe(etag)

    const replaced = await alice.putStoreDocument({
      path: { namespace: ns, id: 'first' },
      header: { 'If-Match': etag ?? '' },
      body: { data: { title: 'Hardware' } },
    })
    expect(replaced.data).toMatchObject({ version: 2, data: { title: 'Hardware' } })

    const listed = await alice.listStoreDocuments({ path: { namespace: ns } })
    expect(listed.items.map((d) => [d.id, d.version])).toEqual([['first', 2]])
    expect(listed.next_cursor).toBeNull()

    await expect(
      alice.deleteStoreDocument({
        path: { namespace: ns, id: 'first' },
        header: { 'If-Match': replaced.headers.ETag ?? '' },
      }),
    ).resolves.toBeUndefined()
    const gone = await problem(alice.getStoreDocument({ path: { namespace: ns, id: 'first' } }))
    expect(gone.type).toBe('urn:embertrail:problem:not-found')
  })

  it('pages a namespace', async () => {
    for (const id of ['x', 'y', 'z']) {
      await alice.putStoreDocument({ path: { namespace: 'paged', id }, body: { data: { id } } })
    }
    const ids = []
    for await (const doc of items((cursor) =>
      alice.listStoreDocuments({
        path: { namespace: 'paged' },
        query: { limit: 2, ...(cursor === undefined ? {} : { cursor }) },
      }),
    )) {
      ids.push(doc.id)
    }
    expect(ids.sort()).toEqual(['x', 'y', 'z'])
  })

  it('owns a document for the Team named in Embertrail-Owner', async () => {
    await t.team('crew', { editors: ['alice'], members: ['bob'] })
    const asTeam = await clientFor(t, 'alice', scopes, {
      headers: { 'Embertrail-Owner': 'team:crew' },
    })
    const bob = await clientFor(t, 'bob', ['store:read', 'store:write'])
    const bobAsTeam = await clientFor(t, 'bob', ['store:read', 'store:write'], {
      headers: { 'Embertrail-Owner': 'team:crew' },
    })
    const dave = await clientFor(t, 'dave', ['store:read'])

    const shared = await asTeam.putStoreDocument({
      path: { namespace: 'board', id: 'plan' },
      body: { data: { goal: 'ship' } },
    })
    expect(shared.data.owner).toEqual({ kind: 'team', id: 'crew' })

    // A member reads the Team's document without the header; only an editor acts as the Team.
    const read = await bob.getStoreDocument({ path: { namespace: 'board', id: 'plan' } })
    expect(read.data.data).toEqual({ goal: 'ship' })
    const refused = await problem(
      bobAsTeam.putStoreDocument({
        path: { namespace: 'board', id: 'plan' },
        body: { data: { goal: 'hijack' } },
      }),
    )
    expect(refused).toMatchObject({ type: 'urn:embertrail:problem:forbidden', status: 403 })
    // Someone outside the Team cannot see it.
    const hidden = await problem(
      dave.getStoreDocument({ path: { namespace: 'board', id: 'plan' } }),
    )
    expect(hidden.type).toBe('urn:embertrail:problem:not-found')
  })
})

describe('the Admin and self-management API', () => {
  let root: EmbertrailClient

  beforeAll(async () => {
    await t.user('root', { admin: true })
    root = recordCalls(
      await clientFor(t, 'root', [...scopes, 'admin', 'self:manage']),
      called,
    ).client
  })

  it('bootstrap exchanges BOOTSTRAP_TOKEN for the first admin once', async () => {
    const fresh = await testHub({
      modules: hubModules,
      config: { bootstrapToken: 'test-bootstrap-secret-0123456789abcdef' },
    })
    try {
      const { createClient } = await import('./index.ts')
      const anonymous = createClient({
        baseUrl: 'http://hub.test',
        token: 'test-bootstrap-secret-0123456789abcdef',
        fetch: (input, init) => fresh.hub.fetch(new Request(input, init)),
      })
      const started = await anonymous.bootstrap({ body: { name: 'Ada' } })
      expect(started.user).toMatchObject({ name: 'Ada', admin: true })
      expect(started.token).toMatch(/^et_/)
      called.add('bootstrap')
      const again = await problem(anonymous.bootstrap({}))
      expect(again.status).toBe(401)
    } finally {
      await fresh.close()
    }
  })

  it('creates, lists and deletes Users, Teams and members', async () => {
    const created = await root.createUser({ body: { name: 'Bob', token: false } })
    expect(created.token).toBeNull()
    const bob = created.user.id
    expect((await root.listUsers()).items.map((u) => u.id)).toContain(bob)

    const team = await root.createTeam({ body: { name: 'Crew' } })
    await expect(
      root.setTeamMember({ path: { team_id: team.id, user_id: bob }, body: { role: 'editor' } }),
    ).resolves.toEqual({ team_id: team.id, user_id: bob, role: 'editor' })
    const teams = await root.listTeams()
    expect(teams.items.find((x) => x.id === team.id)?.members).toEqual([
      { user_id: bob, role: 'editor' },
    ])
    await expect(
      root.removeTeamMember({ path: { team_id: team.id, user_id: bob } }),
    ).resolves.toBeUndefined()
    await expect(root.deleteTeam({ path: { team_id: team.id } })).resolves.toBeUndefined()
    await expect(root.deleteUser({ path: { user_id: bob } })).resolves.toBeUndefined()
    const missing = await problem(root.deleteUser({ path: { user_id: bob } }))
    expect(missing.status).toBe(404)
  })

  it('getSelf tells who you are, your Scopes and your Teams', async () => {
    const solo = recordCalls(await clientFor(t, 'solo', ['otel:read']), called).client
    await expect(solo.getSelf()).resolves.toEqual({
      user: { id: 'solo', name: 'solo', email: null, admin: false },
      scopes: ['otel:read'],
      teams: [],
    })
    // Alice edits the `crew` Team, created for the store tests above.
    const me = await alice.getSelf()
    expect(me.scopes).toEqual(expect.arrayContaining([...scopes]))
    expect(me.teams).toEqual([{ id: 'crew', name: 'crew', editor: true }])
  })

  it('manages your own Sources, Tokens, Accounts and Grants', async () => {
    const { source, token } = await root.createSource({ body: { name: 'laptop' } })
    expect(token.record).toMatchObject({ kind: 'ingest', source_id: source.id })
    expect((await root.listSources()).items.map((s) => s.id)).toContain(source.id)
    await expect(
      root.renameSource({ path: { source_id: source.id }, body: { name: 'work laptop' } }),
    ).resolves.toMatchObject({ name: 'work laptop' })
    expect((await root.listAllSources()).items.map((s) => s.id)).toContain(source.id)

    const issued = await root.issueToken({
      body: { kind: 'management', scopes: ['otel:read'], name: 'reader' },
    })
    expect((await root.listTokens()).items.map((r) => r.id)).toContain(issued.record.id)
    await expect(
      root.revokeToken({ path: { token_id: issued.record.id } }),
    ).resolves.toBeUndefined()

    await t.team('grantees', { members: ['alice'] })
    // Alice's Account came from the seeded Session.
    const me = recordCalls(await clientFor(t, 'alice', [...scopes, 'self:manage']), called).client
    const [account] = (await me.listAccounts()).items
    if (account === undefined) throw new Error('Expected an Account from the seeded Session')
    await expect(
      me.setAccountLabel({ path: { account_id: account.id }, body: { label: 'Work' } }),
    ).resolves.toMatchObject({ label: 'Work', labelled: true })
    const grant = await me.createGrant({
      body: { module: 'otel', account_id: account.id, team_id: 'grantees' },
    })
    expect((await me.listGrants()).items.map((g) => g.id)).toContain(grant.id)
    await expect(me.revokeGrant({ path: { grant_id: grant.id } })).resolves.toBeUndefined()

    await expect(root.deleteSource({ path: { source_id: source.id } })).resolves.toBeUndefined()
    const other = await root.createSource({ body: { name: 'other' } })
    await expect(
      root.deleteAnySource({ path: { source_id: other.source.id } }),
    ).resolves.toBeUndefined()
  })
})

describe('problem responses', () => {
  it('becomes a ProblemError with the type URN, status and request_id', async () => {
    const error = await problem(alice.queryMetrics({ body: { metric: '' } as never }))
    expect(error).toMatchObject({
      type: 'urn:embertrail:problem:validation',
      status: 400,
      name: 'ProblemError',
    })
    expect(error.request_id).toMatch(/\S/)
    expect(error.errors.length).toBeGreaterThan(0)
    expect(isProblemError(error, 'urn:embertrail:problem:validation')).toBe(true)
  })

  it('carries invalid-cursor, invalid and sql-error from the Hub', async () => {
    const cursor = await problem(alice.listSessions({ query: { cursor: 'nonsense' } }))
    expect(cursor.type).toBe('urn:embertrail:problem:invalid-cursor')

    const zone = await problem(
      alice.queryMetrics({
        body: { metric: 'm', aggregation: 'sum', ...window, tz: 'Mars/Olympus' },
      }),
    )
    expect(zone).toMatchObject({ type: 'urn:embertrail:problem:invalid', status: 422 })

    const sql = await problem(alice.runSql({ body: { sql: 'select * from nowhere' } }))
    expect(sql).toMatchObject({ type: 'urn:embertrail:problem:sql-error', status: 422 })
  })

  it('carries precondition-failed for a stale If-Match', async () => {
    await alice.putStoreDocument({ path: { namespace: 'etag', id: 'a' }, body: { data: 1 } })
    const stale = await problem(
      alice.putStoreDocument({
        path: { namespace: 'etag', id: 'a' },
        header: { 'If-Match': '"stale"' },
        body: { data: 2 },
      }),
    )
    expect(stale).toMatchObject({ type: 'urn:embertrail:problem:precondition-failed', status: 412 })
  })

  it('carries forbidden for a missing Scope and unauthenticated for no Token', async () => {
    const readOnly = await clientFor(t, 'carol', ['otel:read'])
    const forbidden = await problem(readOnly.runSql({ body: { sql: 'select 1' } }))
    expect(forbidden.type).toBe('urn:embertrail:problem:forbidden')

    const { createClient } = await import('./index.ts')
    const anonymous = createClient({
      baseUrl: 'http://hub.test',
      fetch: (input, init) => t.hub.fetch(new Request(input, init)),
    })
    const unauthenticated = await problem(anonymous.getInventory())
    expect(unauthenticated).toMatchObject({
      type: 'urn:embertrail:problem:unauthenticated',
      status: 401,
    })
  })
})

describe('coverage', () => {
  it('has called every operation in the spec', () => {
    expect([...called].sort()).toEqual([...operationIds].sort())
  })
})
