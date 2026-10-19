import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { startMockHub, type MockHub } from '../test/mock-hub.ts'
import { responseExample } from '../test/spec.ts'

import {
  createClient,
  isProblemError,
  ProblemError,
  problemTypes,
  UnexpectedResponseError,
  type EmbertrailClient,
  type Problem,
} from './index.ts'

let hub: MockHub
let client: EmbertrailClient

beforeAll(async () => {
  hub = await startMockHub()
  client = createClient({ baseUrl: hub.baseUrl })
})
afterAll(() => hub.close())

const problemHeaders = { 'content-type': 'application/problem+json' }

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected the call to fail')
    },
    (error: unknown) => error,
  )
}

describe('a problem response', () => {
  it('becomes a ProblemError with its type URN, status, request_id and errors', async () => {
    const problem = responseExample<Problem>('BadRequest')
    hub.respond({ status: 400, headers: problemHeaders, body: problem })

    const error = await rejection(
      client.queryMetrics({
        body: {
          metric: 'claude_code.cost.usage',
          aggregation: 'sum',
          from: '2026-10-01T00:00:00Z',
          to: '2026-10-08T00:00:00Z',
          tz: 'UTC',
          group_by: ['a', 'b', 'c', 'd'],
        },
      }),
    )

    expect(error).toBeInstanceOf(ProblemError)
    expect(error).toMatchObject({
      name: 'ProblemError',
      message: 'group_by takes at most 3 dimensions',
      type: 'urn:embertrail:problem:validation',
      status: 400,
      title: 'Request failed validation',
      request_id: '01J9Z6Q4X1',
      errors: [{ pointer: '/group_by', message: 'must NOT have more than 3 items' }],
      problem,
    })
    expect(isProblemError(error, 'urn:embertrail:problem:validation')).toBe(true)
    expect(isProblemError(error, 'urn:embertrail:problem:internal')).toBe(false)
  })

  it.each(problemTypes)('keeps the type %s', async (type) => {
    hub.respond({
      status: 422,
      headers: problemHeaders,
      body: { type, title: 'Problem', status: 422, request_id: 'r1', sqlstate: '42601' },
    })

    const error = await rejection(client.runSql({ body: { sql: 'select' } }))

    expect(isProblemError(error, type)).toBe(true)
    expect(error).toMatchObject({ type, status: 422, request_id: 'r1', errors: [] })
    expect((error as ProblemError).problem.sqlstate).toBe('42601')
  })

  it('surfaces a precondition failure on a conditional store write', async () => {
    hub.respond({
      status: 412,
      headers: problemHeaders,
      body: {
        type: 'urn:embertrail:problem:precondition-failed',
        title: 'Precondition failed',
        status: 412,
        request_id: 'r2',
      },
    })

    const error = await rejection(
      client.putStoreDocument({
        path: { namespace: 'embertrail-dashboard', id: 'overview' },
        header: { 'If-None-Match': '*' },
        body: { data: {} },
      }),
    )

    expect(isProblemError(error, 'urn:embertrail:problem:precondition-failed')).toBe(true)
    expect(hub.requests.at(-1)?.headers['if-none-match']).toBe('*')
  })

  it('passes an unknown type through, since new types may be added within v1', async () => {
    hub.respond({
      status: 429,
      headers: problemHeaders,
      body: {
        type: 'urn:embertrail:problem:rate-limited',
        title: 'Slow down',
        status: 429,
        request_id: 'r3',
      },
    })

    const error = await rejection(client.getInventory())

    expect(error).toBeInstanceOf(ProblemError)
    expect((error as ProblemError).type).toBe('urn:embertrail:problem:rate-limited')
  })
})

describe('a response the spec does not describe', () => {
  it('is an UnexpectedResponseError when an error has no problem body', async () => {
    hub.respond({
      status: 502,
      headers: { 'content-type': 'text/html' },
      body: '<h1>Bad gateway</h1>',
    })

    const error = await rejection(client.getInventory())

    expect(error).toBeInstanceOf(UnexpectedResponseError)
    expect(error).toMatchObject({ status: 502, body: '<h1>Bad gateway</h1>' })
  })

  it('is an UnexpectedResponseError when a success body is not JSON', async () => {
    hub.respond({ status: 200, headers: { 'content-type': 'text/plain' }, body: 'ok' })

    const error = await rejection(client.getInventory())

    expect(error).toBeInstanceOf(UnexpectedResponseError)
    expect(error).toMatchObject({ status: 200, body: 'ok' })
  })
})
