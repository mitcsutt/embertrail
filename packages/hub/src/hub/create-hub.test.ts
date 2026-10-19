import { sql } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { noEdgeIdentity } from '../identity/edge'
import { ledger } from '../testing/ledger'
import { pgliteDb } from '../testing/pglite'
import { testHub } from '../testing/test-hub'
import type { TestHub } from '../testing/test-hub'
import { createHub } from './create-hub'

const write = ['ledger:read', 'ledger:write'] as const

describe('createHub', () => {
  let t: TestHub | undefined

  afterEach(async () => {
    await t?.close()
    t = undefined
  })

  const start = async (options: Partial<Parameters<typeof testHub>[0]> = {}) => {
    t = await testHub({ modules: [ledger], ...options })
    return t
  }

  it('serves the OpenAPI document, assembled from every op, without auth', async () => {
    const { anonymous } = await start()
    const response = await anonymous.get('/api/v1/openapi.json')
    expect(response.status).toBe(200)
    const document = (await response.json()) as {
      openapi: string
      paths: Record<string, Record<string, Record<string, unknown>>>
    }
    expect(document.openapi).toBe('3.1.0')
    expect(document.paths['/api/v1/ledger/entries/{id}']?.get).toMatchObject({
      operationId: 'ledger.getEntry',
      'x-embertrail-module': 'ledger',
      'x-embertrail-scope': 'ledger:read',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    })
    expect(document.paths['/api/v1/ledger/entries']?.post).toMatchObject({
      'x-embertrail-scope': 'ledger:write',
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { required: ['note'] } } },
      },
    })
    expect(document.paths['/api/v1/ledger/raw-readings']?.post).toMatchObject({
      'x-embertrail-scope': 'ledger:write',
      responses: { '202': { description: 'Stored' } },
    })
  })

  it('answers an unknown route with a 404 problem', async () => {
    const { anonymous } = await start()
    const response = await anonymous.get('/api/v1/nowhere')
    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toBe('application/problem+json')
    expect(await response.json()).toMatchObject({
      type: 'urn:embertrail:problem:not-found',
      status: 404,
      detail: 'No route for GET /api/v1/nowhere',
    })
  })

  it('sweeps only rows older than retentionDays, across Owners', async () => {
    const now = new Date('2026-10-19T00:00:00Z')
    const hub = await start({ config: { retentionDays: 30 }, clock: () => now })
    await hub.as('alice', write).post('/api/v1/ledger/entries', { note: 'new' })
    await hub.as('bob', write).post('/api/v1/ledger/entries', { note: 'old' })
    await hub.sql(sql`update ledger.entries set created_at = '2026-09-01' where note = 'old'`)
    expect(await hub.hub.runRetention()).toEqual({ deleted: 1 })
    expect(await hub.sql(sql`select note from ledger.entries`)).toEqual([{ note: 'new' }])
  })

  it('keeps everything when retentionDays is unset', async () => {
    const hub = await start()
    await hub.as('alice', write).post('/api/v1/ledger/entries', { note: 'kept' })
    await hub.sql(sql`update ledger.entries set created_at = '2000-01-01'`)
    expect(await hub.hub.runRetention()).toEqual({ deleted: 0 })
  })

  it('deletes by Source across Signal tables only, and by Owner across every table', async () => {
    const hub = await start()
    const laptop = hub.as('alice', write, { sourceId: 'laptop' })
    await laptop.post('/api/v1/ledger/readings', { value: 1 })
    await laptop.post('/api/v1/ledger/entries', { note: 'kept' })
    await hub
      .as('alice', write, { sourceId: 'desktop' })
      .post('/api/v1/ledger/readings', { value: 2 })
    await hub.as('bob', write).post('/api/v1/ledger/entries', { note: 'bob' })

    expect(await hub.hub.deleteBySource('laptop')).toBe(1)
    expect(await hub.sql(sql`select source_id from ledger.readings`)).toEqual([
      { source_id: 'desktop' },
    ])
    expect(await hub.hub.deleteByOwner('alice')).toBe(2)
    expect(await hub.sql(sql`select owner_id from ledger.entries`)).toEqual([{ owner_id: 'bob' }])
  })

  it('exports one Owner’s rows of one Module as JSON Lines', async () => {
    const hub = await start()
    await hub.as('alice', write).post('/api/v1/ledger/entries', { note: 'mine' })
    await hub.as('bob', write).post('/api/v1/ledger/entries', { note: 'not mine' })
    const lines = (await hub.hub.exportOwner('ledger', 'alice')).trimEnd().split('\n')
    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual([
      {
        table: 'entries',
        row: expect.objectContaining({ note: 'mine', owner_id: 'alice' }) as unknown,
      },
    ])
  })

  it('reports an unexpected error with its request id and Module', async () => {
    const hub = await start()
    const response = await hub.as('alice', write).post('/api/v1/ledger/fail', { note: 'x' })
    const body = (await response.json()) as { request_id: string; module: string }
    expect(body.module).toBe('ledger')
    expect(hub.errors).toHaveLength(1)
    expect(hub.errors[0]).toHaveProperty('message', 'boom')
  })

  it('reports a failure before the op runs as the core’s, not the Module’s', async () => {
    const db = pgliteDb()
    try {
      const errors: unknown[] = []
      const hub = createHub({
        config: {},
        ports: { db, edgeIdentity: noEdgeIdentity() },
        modules: [ledger],
        directory: {
          token: () => Promise.reject(new Error('directory down')),
          edgeUser: () => Promise.resolve(null),
        },
        onError: (error) => errors.push(error),
      })
      await hub.migrate()
      const response = await hub.fetch(
        new Request('http://hub.test/api/v1/ledger/entries', {
          headers: { authorization: 'Bearer any' },
        }),
      )
      expect(response.status).toBe(500)
      expect(await response.json()).toMatchObject({ module: 'core' })
      expect(errors).toHaveLength(1)
    } finally {
      await db.close()
    }
  })
})
