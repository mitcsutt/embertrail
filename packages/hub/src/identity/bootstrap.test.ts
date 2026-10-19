import { sql } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbPort } from '../db/port'
import type { HubConfig } from '../hub/boot'
import { createHub } from '../hub/create-hub'
import { pgliteDb } from '../testing/pglite'
import { probe } from '../testing/probe'
import { testHub } from '../testing/test-hub'
import type { TestHub } from '../testing/test-hub'
import { noEdgeIdentity } from './edge'

const alpha = probe('alpha')
const bootstrapToken = 'test-bootstrap-secret-0123456789abcdef'

interface Bootstrapped {
  user: { id: string; name: string; email: string | null; admin: boolean }
  token: string
}

const unusedDb: DbPort = {
  transaction: () => Promise.reject(new Error('no database in config tests')),
  privileged: () => Promise.reject(new Error('no database in config tests')),
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

describe('bootstrap', () => {
  let t: TestHub | undefined

  afterEach(async () => {
    await t?.close()
    t = undefined
  })

  const start = async (config: HubConfig = { bootstrapToken }) => {
    t = await testHub({ modules: [alpha], config })
    return t
  }

  const exchange = (hub: TestHub, token: string, body?: unknown) =>
    hub.anonymous.fetch('/api/v1/bootstrap', {
      method: 'POST',
      headers: { ...bearer(token), 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

  it('BOOTSTRAP_TOKEN creates the first User and an admin Token, once', async () => {
    const hub = await start()
    const first = await exchange(hub, bootstrapToken, { name: 'Ada', email: 'Ada@Example.com' })
    expect(first.status).toBe(200)
    const { user, token } = (await first.json()) as Bootstrapped
    expect(user).toMatchObject({ name: 'Ada', email: 'ada@example.com', admin: true })
    const whoami = await hub.anonymous.fetch('/api/v1/alpha/whoami', { headers: bearer(token) })
    expect(await whoami.json()).toMatchObject({
      userId: user.id,
      scopes: ['alpha:read', 'alpha:write', 'admin', 'self:manage', 'sql:read'],
    })

    const second = await exchange(hub, bootstrapToken)
    expect(second.status).toBe(401)
    expect(await second.json()).toMatchObject({
      type: 'urn:embertrail:problem:unauthenticated',
      detail: 'The Hub is already bootstrapped',
    })
    expect(await hub.sql(sql`select count(*)::int as count from core.users`)).toEqual([
      { count: 1 },
    ])
  })

  it('stays used after a restart, even once every User is gone', async () => {
    const db = pgliteDb()
    try {
      const boot = async () => {
        const hub = createHub({
          config: { bootstrapToken },
          ports: { db, edgeIdentity: noEdgeIdentity() },
          modules: [alpha],
        })
        await hub.migrate()
        return hub
      }
      const request = () =>
        new Request('http://hub.test/api/v1/bootstrap', {
          method: 'POST',
          headers: bearer(bootstrapToken),
        })
      expect((await (await boot()).fetch(request())).status).toBe(200)
      await db.privileged((tx) => tx.execute(sql`delete from core.users`))
      expect((await (await boot()).fetch(request())).status).toBe(401)
    } finally {
      await db.close()
    }
  })

  it('refuses a wrong token, no token, and a Hub without BOOTSTRAP_TOKEN, with 401', async () => {
    const hub = await start()
    expect((await exchange(hub, `${bootstrapToken}x`)).status).toBe(401)
    expect((await hub.anonymous.post('/api/v1/bootstrap')).status).toBe(401)
    await hub.close()
    t = undefined
    const unset = await start({})
    expect((await exchange(unset, bootstrapToken)).status).toBe(401)
    expect(await unset.sql(sql`select id from core.users`)).toEqual([])
  })

  it('needs a BOOTSTRAP_TOKEN of at least 32 characters', () => {
    expect(() =>
      createHub({
        config: { bootstrapToken: 'short' },
        ports: { db: unusedDb, edgeIdentity: noEdgeIdentity() },
        modules: [],
      }),
    ).toThrow(/^Hub config: invalid config: .*at least 32 characters/s)
  })

  it('the zero-config start goes through the same one-time path', async () => {
    const hub = await start()
    const first = await hub.hub.directory.createFirstUser()
    expect(first?.user).toMatchObject({ name: 'admin', admin: true, email: null })
    expect(await hub.hub.directory.createFirstUser()).toBeNull()
    expect((await exchange(hub, bootstrapToken)).status).toBe(401)
  })
})

describe('the solo path', () => {
  it('one User, no Teams, no Grants: first start, connect a Source, ingest and read back', async () => {
    const t = await testHub({ modules: [alpha] })
    try {
      const first = await t.hub.directory.createFirstUser()
      expect(first).not.toBeNull()
      const { user, token } = first as NonNullable<typeof first>

      // What `embertrail setup claude-code` does through the Admin API (#30, #31).
      const laptop = await t.hub.directory.createSource(user.id, { name: 'laptop' })
      const ingest = await t.hub.directory.issueToken(user.id, {
        kind: 'ingest',
        scopes: ['alpha:write'],
        sourceId: laptop.id,
      })
      const sent = await t.anonymous.fetch('/api/v1/alpha/signals', {
        method: 'POST',
        headers: { ...bearer(ingest.token), 'content-type': 'application/json' },
        body: JSON.stringify({ value: 7, attributes: { 'user.email': 'me@example.com' } }),
      })
      expect(sent.status).toBe(200)

      const read = await t.anonymous.fetch('/api/v1/alpha/signals', { headers: bearer(token) })
      expect(await read.json()).toMatchObject({ signals: [{ value: 7, ownerId: user.id }] })
      expect(await t.hub.directory.accounts(user.id)).toEqual([
        expect.objectContaining({ label: 'example.com', email: 'me@example.com' }),
      ])
      expect(
        await t.sql(sql`select
          (select count(*)::int from core.teams) as teams,
          (select count(*)::int from core.team_members) as members,
          (select count(*)::int from core.grants) as grants`),
      ).toEqual([{ teams: 0, members: 0, grants: 0 }])
    } finally {
      await t.close()
    }
  })
})
