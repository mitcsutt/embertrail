import { sql } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import type { DbPort } from '../db/port'
import type { Ctx } from '../module/define'
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
    expect(document.paths['/api/v1/bootstrap']?.post).toMatchObject({
      operationId: 'core.bootstrap',
      'x-embertrail-module': 'core',
    })
    expect(document.paths['/api/v1/ledger/raw-readings']?.post).toMatchObject({
      'x-embertrail-scope': 'ledger:write',
      responses: { '202': { description: 'Stored' } },
    })
  })

  it('serves the API reference and llms.txt without auth', async () => {
    const { anonymous } = await start()
    const docs = await anonymous.get('/api/v1/docs')
    expect(docs.status).toBe(200)
    expect(docs.headers.get('content-type')).toBe('text/html; charset=utf-8')
    const page = await docs.text()
    expect(page).toContain('<code>/api/v1/ledger/entries/{id}</code>')
    expect(page).toContain('ledger:read')

    const llms = await anonymous.get('/llms.txt')
    expect(llms.status).toBe(200)
    expect(llms.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
    const text = await llms.text()
    expect(text).toContain('(http://hub.test/api/v1/openapi.json)')
    expect(text).toContain('`GET /api/v1/ledger/entries/{id}`')
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
    await hub.as('alice', write).post('/api/v1/ledger/entries', { note: 'kept' })
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
    const lines = (await new Response(hub.hub.exportOwner('ledger', 'alice')).text())
      .trimEnd()
      .split('\n')
    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual([
      {
        table: 'entries',
        row: expect.objectContaining({ note: 'mine', owner_id: 'alice' }) as unknown,
      },
    ])
  })

  it.each([500, 501, 1001])('exports %i rows across pages, each exactly once', async (count) => {
    const hub = await start()
    await hub.sql(
      sql`insert into ledger.entries (note, owner_id)
        select 'n' || g, 'alice' from generate_series(1, ${count}::int) g`,
    )
    await hub.sql(sql`insert into ledger.entries (note, owner_id) values ('other', 'bob')`)
    const lines = (await new Response(hub.hub.exportOwner('ledger', 'alice')).text())
      .trimEnd()
      .split('\n')
    const notes = lines.map((line) => (JSON.parse(line) as { row: { note: string } }).row.note)
    expect(notes).toHaveLength(count)
    expect(new Set(notes).size).toBe(count)
  })

  it('streams an export, holding its transaction only until the stream ends', async () => {
    let produced = 0
    let released = 0
    const endless = {
      ...ledger,
      async *export(ctx: Ctx) {
        try {
          for (;;) {
            await ctx.db.execute(sql`select 1`)
            produced += 1
            if (produced === 10) throw new Error('export failed')
            yield JSON.stringify({ n: produced })
          }
        } finally {
          released += 1
        }
      },
    }
    const hub = await start({ modules: [endless] })
    const decoder = new TextDecoder()

    const reader = hub.hub.exportOwner('ledger', 'alice').getReader()
    const lines: string[] = []
    for (let i = 0; i < 3; i++) {
      const { value } = await reader.read()
      lines.push(decoder.decode(value))
    }
    expect(lines).toEqual(['{"n":1}\n', '{"n":2}\n', '{"n":3}\n'])
    expect(produced).toBeLessThanOrEqual(4)
    await reader.cancel()
    expect(released).toBe(1)
    expect((await hub.as('alice', write).get('/api/v1/ledger/entries')).status).toBe(200)

    expect(hub.errors).toEqual([])

    produced = 0
    await expect(new Response(hub.hub.exportOwner('ledger', 'alice')).text()).rejects.toThrow()
    expect(released).toBe(2)
    expect(hub.errors).toEqual([expect.objectContaining({ message: 'export failed' })])
    expect((await hub.as('alice', write).get('/api/v1/ledger/entries')).status).toBe(200)
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
      let down = false
      const flaky: DbPort = {
        ...db,
        privileged: (fn) =>
          down ? Promise.reject(new Error('directory down')) : db.privileged(fn),
      }
      const hub = createHub({
        config: {},
        ports: { db: flaky, edgeIdentity: noEdgeIdentity() },
        modules: [ledger],
        onError: (error) => errors.push(error),
      })
      await hub.migrate()
      await hub.boot()
      down = true
      const response = await hub.fetch(
        new Request('http://hub.test/api/v1/ledger/entries', {
          headers: { authorization: `Bearer et_${'a'.repeat(16)}_${'b'.repeat(40)}` },
        }),
      )
      expect(response.status).toBe(500)
      expect(await response.json()).toMatchObject({ module: 'core' })
      expect(errors).toHaveLength(1)
    } finally {
      await db.close()
    }
  })

  describe('typed op replies', () => {
    it('reads a header into the input, and only from the header', async () => {
      const client = (await start()).as('alice', write)
      const sent = await client.fetch('/api/v1/ledger/stamps/a?stamp=query', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'ledger-stamp': 'header' },
        body: JSON.stringify({ note: 'n', stamp: 'body' }),
      })
      expect(sent.status).toBe(201)
      expect(sent.headers.get('etag')).toBe('"1"')
      expect(await sent.json()).toEqual({ id: 'a', note: 'n', stamp: 'header' })

      const unsent = await client.put('/api/v1/ledger/stamps/a?stamp=query', {
        note: 'n',
        stamp: 'body',
      })
      expect(unsent.status).toBe(200)
      expect(await unsent.json()).toEqual({ id: 'a', note: 'n', stamp: null })
    })

    it('answers 204 with no body', async () => {
      const response = await (await start()).as('alice', write).delete('/api/v1/ledger/stamps/a')
      expect(response.status).toBe(204)
      expect(await response.text()).toBe('')
    })

    it('refuses a status the op does not declare, as the Module’s error', async () => {
      const hub = await start()
      const response = await hub.as('alice', write).post('/api/v1/ledger/undeclared-status', {})
      expect(response.status).toBe(500)
      expect(await response.json()).toMatchObject({
        module: 'ledger',
        detail: 'op "ledger.undeclaredStatus" answered 201, not in its statuses',
      })
    })

    it('documents header parameters, each status and the ETag', async () => {
      const { hub } = await start()
      const paths = hub.openapi.paths as Record<string, Record<string, Record<string, unknown>>>
      const put = paths['/api/v1/ledger/stamps/{id}']?.put
      expect(put?.parameters).toEqual([
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'Ledger-Stamp', in: 'header', required: false, schema: { type: 'string' } },
        expect.objectContaining({ name: 'Embertrail-Owner', in: 'header', required: false }),
      ])
      expect(put?.requestBody).toMatchObject({
        content: { 'application/json': { schema: { properties: { note: {} } } } },
      })
      expect(Object.keys(put?.responses ?? {})).toEqual(['200', '201', '403', 'default'])
      expect(put?.responses).toMatchObject({
        '201': { headers: { ETag: { $ref: '#/components/headers/ETag' } } },
      })
      expect(paths['/api/v1/ledger/stamps/{id}']?.delete?.responses).toEqual({
        '204': { description: 'No Content' },
        '403': { $ref: '#/components/responses/SourceRefused' },
        default: { $ref: '#/components/responses/Problem' },
      })
    })
  })

  describe('ctx.ownerOf', () => {
    it('calls every Owner a User when there are no Teams', async () => {
      const response = await (await start()).as('alice', write).get('/api/v1/ledger/owner')
      expect(await response.json()).toEqual({ kind: 'user', id: 'alice' })
    })

    it('calls an Owner that names a Team a Team', async () => {
      const hub = await start()
      await hub.team('crew', { editors: ['alice'] })
      const response = await hub.as('alice', write, { team: 'crew' }).get('/api/v1/ledger/owner')
      expect(await response.json()).toEqual({ kind: 'team', id: 'crew' })
    })
  })
})
