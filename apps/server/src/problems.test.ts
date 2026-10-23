import { readFileSync } from 'node:fs'

import { fakeEdgeIdentity, testHub } from '@mitcsutt/embertrail-hub/testing'
import type { TestClient, TestHub } from '@mitcsutt/embertrail-hub/testing'
import { hubModules } from '@mitcsutt/embertrail-modules'
import { assertProblem, postOtlp } from '@mitcsutt/embertrail-otel/testing'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { databaseUrl, skipWithoutPostgres } from './testing/postgres'
import { openTempDb } from './testing/temp-database'

// Every problem `type` in spec/query-api.yaml, produced over HTTP with the status the spec's
// responses document (#27). Other suites cover the same types in more depth; this one is the
// ledger: add a type to the spec and its row here, or the last test fails.
const spec = parse(
  readFileSync(new URL('../../../spec/query-api.yaml', import.meta.url), 'utf8'),
) as {
  components: { schemas: { Problem: { properties: { type: { enum: string[] } } } } }
}
const documented = spec.components.schemas.Problem.properties.type.enum.map((urn) =>
  urn.replace('urn:embertrail:problem:', ''),
)

const window = { from: '2026-10-01T00:00:00Z', to: '2026-12-01T00:00:00Z', tz: 'UTC' }
const read = ['otel:read', 'otel:write', 'sql:read', 'store:read', 'store:write'] as const
const note = '/api/v1/store/notes/first'

/** The slugs the tests below have seen the Hub answer with. */
const produced = new Set<string>()

/**
 * What a response is: its problem `type` slug and status, once the body has validated as the
 * spec's Problem and carried the problem media type and the same status.
 */
async function problemOf(response: Response) {
  expect(response.headers.get('content-type')).toMatch(/^application\/problem\+json/)
  const body = (await response.json()) as { type: string; status: number }
  const slug = body.type.replace('urn:embertrail:problem:', '')
  assertProblem(body, slug)
  expect(body.status).toBe(response.status)
  produced.add(slug)
  return { slug, status: response.status }
}

const at = String(BigInt(Date.parse('2026-10-02T10:00:00Z')) * 1_000_000n)
const key = (n: number) => ({ key: 'n', value: { intValue: n } })

/** One delta sum with a point per `n`, each in a group of its own. */
const widePoints = (count: number) => ({
  resourceMetrics: [
    {
      resource: { attributes: [{ key: 'service.name', value: { stringValue: 'test' } }] },
      scopeMetrics: [
        {
          scope: { name: 'test' },
          metrics: [
            {
              name: 'wide',
              sum: {
                aggregationTemporality: 1,
                isMonotonic: true,
                dataPoints: Array.from({ length: count }, (_, n) => ({
                  attributes: [key(n)],
                  startTimeUnixNano: at,
                  timeUnixNano: at,
                  asDouble: 1,
                })),
              },
            },
          ],
        },
      ],
    },
  ],
})

describe('problem types', () => {
  let t: TestHub
  let alice: TestClient

  beforeAll(async () => {
    t = await testHub({
      modules: hubModules,
      edgeIdentity: fakeEdgeIdentity({ bob: 'bob@example.com' }),
    })
    await t.user('bob', { email: 'bob@example.com' })
    alice = t.as('alice', read)
  }, 60_000)

  afterAll(async () => {
    await t.close()
  })

  it('validation: 400 for a body the schema refuses', async () => {
    expect(await problemOf(await alice.post('/api/v1/metrics/query', {}))).toEqual({
      slug: 'validation',
      status: 400,
    })
  })

  it('invalid-cursor: 400 for a cursor the Hub did not issue', async () => {
    expect(await problemOf(await alice.get('/api/v1/sessions?cursor=not-a-cursor'))).toEqual({
      slug: 'invalid-cursor',
      status: 400,
    })
  })

  it('unauthenticated: 401 without a Token or Edge Identity', async () => {
    expect(await problemOf(await t.anonymous.get('/api/v1/inventory'))).toEqual({
      slug: 'unauthenticated',
      status: 401,
    })
  })

  it('forbidden: 403 without the Scope', async () => {
    const narrow = t.as('alice', ['store:read'])
    expect(await problemOf(await narrow.get('/api/v1/inventory'))).toEqual({
      slug: 'forbidden',
      status: 403,
    })
  })

  it('identity-conflict: 403 when the Token and the Edge Identity name different Users', async () => {
    const response = await alice.fetch('/api/v1/inventory', {
      headers: { 'x-test-edge-identity': 'bob' },
    })
    expect(await problemOf(response)).toEqual({ slug: 'identity-conflict', status: 403 })
  })

  it('not-found: 404 for a Session that does not exist', async () => {
    expect(await problemOf(await alice.get('/api/v1/sessions/nope'))).toEqual({
      slug: 'not-found',
      status: 404,
    })
  })

  it('conflict: 409 for an id held by a document the caller cannot see', async () => {
    const bob = t.as('bob', read)
    expect((await bob.put(note, { data: { secret: true } })).status).toBe(201)
    expect(await problemOf(await alice.put(note, { data: { mine: true } }))).toEqual({
      slug: 'conflict',
      status: 409,
    })
  })

  it('precondition-failed: 412 for an If-Match that does not hold', async () => {
    const response = await alice.fetch('/api/v1/store/notes/second', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'if-match': '"stale"' },
      body: JSON.stringify({ data: 1 }),
    })
    expect(await problemOf(response)).toEqual({ slug: 'precondition-failed', status: 412 })
  })

  it('payload-too-large: 413 for a document over 1 MiB', async () => {
    const response = await alice.put('/api/v1/store/notes/big', {
      data: 'x'.repeat(1024 * 1024),
    })
    expect(await problemOf(response)).toEqual({ slug: 'payload-too-large', status: 413 })
  })

  it('invalid: 422 for a time zone that does not exist', async () => {
    const response = await alice.post('/api/v1/metrics/query', {
      metric: 'm',
      aggregation: 'sum',
      from: window.from,
      to: window.to,
      tz: 'Mars/Olympus',
    })
    expect(await problemOf(response)).toEqual({ slug: 'invalid', status: 422 })
  })

  it('too-many-rows: 422 for an aggregate over 10,000 rows', async () => {
    const ingest = t.as('alice', ['otel:write'], { sourceId: 'laptop' })
    expect((await postOtlp(ingest, '/v1/metrics', widePoints(10_001))).status).toBe(200)
    const response = await alice.post('/api/v1/metrics/query', {
      metric: 'wide',
      aggregation: 'sum',
      ...window,
      group_by: ['n'],
    })
    expect(await problemOf(response)).toEqual({ slug: 'too-many-rows', status: 422 })
  }, 30_000)

  it('sql-error: 422 for SQL the database refuses', async () => {
    const response = await alice.post('/api/v1/sql', { sql: 'select 1 / 0' })
    expect(await problemOf(response)).toEqual({ slug: 'sql-error', status: 422 })
  })

  it('internal: 500 for a failure the Hub did not expect', async () => {
    // What a migrate run by a role that doesn't own set_config leaves behind: the SQL endpoint
    // refuses to run (docs/sql.md).
    await t.sql(sql`grant execute on function pg_catalog.set_config(text, text, boolean) to public`)
    const response = await alice.post('/api/v1/sql', { sql: 'select 1' })
    expect(await problemOf(response)).toEqual({ slug: 'internal', status: 500 })
    t.errors.length = 0
  })

  describe.skipIf(skipWithoutPostgres)('on Postgres', () => {
    it('query-timeout: 422 for a statement over the 10 s timeout', async () => {
      // PGLite never fires statement_timeout, so this needs a server.
      const server = await testHub({ modules: [], db: await openTempDb(databaseUrl) })
      try {
        const response = await server.as('alice', ['sql:read']).post('/api/v1/sql', {
          sql: 'select pg_sleep(11)',
        })
        expect(await problemOf(response)).toEqual({ slug: 'query-timeout', status: 422 })
      } finally {
        await server.close()
      }
    }, 30_000)
  })

  it('covers every type the spec documents', () => {
    // Without Postgres (local runs) query-timeout is skipped, and only it may be missing.
    const missing = documented.filter((slug) => !produced.has(slug))
    expect(t.errors).toEqual([])
    expect(missing).toEqual(skipWithoutPostgres ? ['query-timeout'] : [])
    expect([...produced].filter((slug) => !documented.includes(slug))).toEqual([])
  })
})
