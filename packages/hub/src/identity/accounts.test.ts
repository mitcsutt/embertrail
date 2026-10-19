import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { probe } from '../testing/probe'
import { testHub } from '../testing/test-hub'
import type { TestClient, TestHub } from '../testing/test-hub'

const alpha = probe('alpha')
const write = ['alpha:read', 'alpha:write'] as const

const work = { 'organization.id': 'org-1', 'user.account_uuid': 'acct-1' }

describe('Account recognition', () => {
  let t: TestHub

  beforeEach(async () => {
    t = await testHub({ modules: [alpha] })
  })

  afterEach(async () => {
    await t.close()
  })

  async function ingest(client: TestClient, attributes: Record<string, string>) {
    const response = await client.post('/api/v1/alpha/signals', { value: 1, attributes })
    expect(response.status).toBe(200)
    return ((await response.json()) as { accountId: string }).accountId
  }

  const keyOf = async (id: string) =>
    (await t.sql<{ key: string }>(sql`select key from core.accounts where id = ${id}`))[0]?.key

  it('keys on organization.id + user.account_uuid first', async () => {
    const laptop = t.as('alice', write, { sourceId: 'laptop' })
    const id = await ingest(laptop, { ...work, 'user.email': 'alice@acme.test' })
    expect(await keyOf(id)).toBe('account:org-1/acct-1')
    // The same Account, whatever email comes with it later.
    expect(await ingest(laptop, { ...work, 'user.email': 'other@acme.test' })).toBe(id)
  })

  it('falls back to user.email, case-insensitively, when either id is missing', async () => {
    const laptop = t.as('alice', write, { sourceId: 'laptop' })
    const id = await ingest(laptop, { 'user.account_uuid': 'acct-1', 'user.email': 'A@Acme.test' })
    expect(await keyOf(id)).toBe('email:a@acme.test')
    expect(await ingest(laptop, { 'organization.id': 'org-1', 'user.email': 'a@acme.test' })).toBe(
      id,
    )
  })

  it('falls back to one Unknown Account per Source', async () => {
    const laptop = t.as('alice', write, { sourceId: 'laptop' })
    const desktop = t.as('alice', write, { sourceId: 'desktop' })
    const onLaptop = await ingest(laptop, {})
    expect(await ingest(laptop, { 'user.email': '  ' })).toBe(onLaptop)
    const onDesktop = await ingest(desktop, {})
    expect(onDesktop).not.toBe(onLaptop)
    expect(await keyOf(onLaptop)).toBe('unknown:laptop')
    expect(await t.hub.directory.accounts('alice')).toEqual([
      expect.objectContaining({ id: onLaptop, label: 'Unknown', sourceId: 'laptop' }),
      expect.objectContaining({ id: onDesktop, label: 'Unknown', sourceId: 'desktop' }),
    ])
  })

  it('gives two Sources of one User the same Account', async () => {
    const laptop = t.as('alice', write, { sourceId: 'laptop' })
    const desktop = t.as('alice', write, { sourceId: 'desktop' })
    expect(await ingest(desktop, work)).toBe(await ingest(laptop, work))
    const byEmail = { 'user.email': 'alice@acme.test' }
    expect(await ingest(desktop, byEmail)).toBe(await ingest(laptop, byEmail))
    expect(await t.hub.directory.accounts('alice')).toHaveLength(2)
  })

  it('keeps each User’s Accounts apart, even for the same Claude identity', async () => {
    const alice = await ingest(t.as('alice', write, { sourceId: 'laptop' }), work)
    const bob = await ingest(t.as('bob', write, { sourceId: 'box' }), work)
    expect(bob).not.toBe(alice)
    expect(await t.sql(sql`select owner_id from core.accounts order by owner_id`)).toEqual([
      { owner_id: 'alice' },
      { owner_id: 'bob' },
    ])
  })

  it('suggests a label from the email domain until the User sets one', async () => {
    const laptop = t.as('alice', write, { sourceId: 'laptop' })
    const id = await ingest(laptop, work)
    expect(await t.hub.directory.accounts('alice')).toEqual([
      expect.objectContaining({ label: 'Unknown', labelled: false, email: null }),
    ])
    // An email arriving later fills in, and so does the suggestion.
    await ingest(laptop, { ...work, 'user.email': 'alice@Acme.test' })
    expect(await t.hub.directory.accounts('alice')).toEqual([
      expect.objectContaining({
        label: 'acme.test',
        labelled: false,
        email: 'alice@acme.test',
        organizationId: 'org-1',
        accountUuid: 'acct-1',
      }),
    ])
    await t.hub.directory.setAccountLabel(id, 'Work')
    expect(await t.hub.directory.accounts('alice')).toEqual([
      expect.objectContaining({ label: 'Work', labelled: true }),
    ])
    await t.hub.directory.setAccountLabel(id, null)
    expect((await t.hub.directory.accounts('alice'))[0]?.label).toBe('acme.test')
  })

  it('refuses a row naming another User’s Account, in the database', async () => {
    const bobs = await ingest(t.as('bob', write, { sourceId: 'box' }), work)
    const laptop = t.as('alice', write, { sourceId: 'laptop' })
    const response = await laptop.post('/api/v1/alpha/forged-signals', {
      value: 1,
      accountId: bobs,
    })
    expect(response.status).toBe(500)
    expect(await t.sql(sql`select id from alpha.signals where owner_id = 'alice'`)).toEqual([])
    const own = await ingest(laptop, work)
    const allowed = await laptop.post('/api/v1/alpha/forged-signals', { value: 2, accountId: own })
    expect(allowed.status).toBe(200)
  })
})
