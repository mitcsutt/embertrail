import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { users } from '../identity/tables'
import { noEdgeIdentity } from '../identity/edge'
import { defineModule, op, reply } from '../module/define'
import { pgliteDb } from '../testing/pglite'
import type { ClosableDbPort } from '../testing/pglite'
import { assembleHub } from './create-hub'
import type { Hub } from './create-hub'
import { hubOps } from './ops'
import type { HubOp, TypedHubOp } from './pipeline'

// Every route goes through one pipeline (#79): these fixtures prove that its documented
// schemas are the ones it validates with, and that it answers every kind of op the same way.

const echoInput = z.strictObject({ name: z.string().min(1), count: z.number().int().optional() })
const echoOutput = z.object({ name: z.string(), count: z.number().optional() })

const fixture = {
  kind: 'typed',
  module: 'core',
  method: 'POST',
  auth: { kind: 'scope', scope: 'self:manage', source: 'accept' },
  transaction: 'none',
  headers: {},
  stamped: 'keep',
  ownerHeader: false,
} as const

/** A fixture core op that answers its input. */
const echo: TypedHubOp = {
  ...fixture,
  key: 'echo',
  path: '/api/v1/fixture/echo',
  summary: 'Echoes its input',
  input: echoInput,
  output: echoOutput,
  statuses: [200],
  etag: false,
  run: (input) => Promise.resolve(input),
}

const replyInput = z.object({ mode: z.enum(['undeclared', 'empty', 'tagged']) })
const replyOutput = z.object({ ok: z.boolean() })

/** Answers a status it doesn't declare, a 204, or an `ETag`, as `mode` says. */
function replyAs({ mode }: z.infer<typeof replyInput>) {
  if (mode === 'undeclared') return Promise.resolve(reply({ ok: true }, { status: 201 }))
  if (mode === 'empty') return Promise.resolve(reply.noContent())
  return Promise.resolve(reply({ ok: true }, { etag: '"v1"' }))
}

const coreReply: TypedHubOp = {
  ...fixture,
  key: 'reply',
  path: '/api/v1/fixture/reply',
  summary: 'Replies as asked',
  input: replyInput,
  output: replyOutput,
  statuses: [200, 204],
  etag: true,
  run: (input) => replyAs(input as z.infer<typeof replyInput>),
}

const replies = defineModule({
  contract: 1,
  name: 'replies',
  tables: {},
  migrations: [],
  ops: {
    reply: op.mutate({
      method: 'POST',
      path: '/api/v1/replies/reply',
      summary: 'Replies as asked',
      input: replyInput,
      output: replyOutput,
      statuses: [200, 204],
      etag: true,
      run: replyAs,
    }),
  },
})

const extra: readonly HubOp[] = [echo, coreReply]
const bootstrapToken = 'b'.repeat(40)

type Operation = Record<string, unknown>
type Paths = Record<string, Record<string, Operation | undefined> | undefined>

/** The JSON Schema a Standard JSON Schema converts to, as `buildOpenApi` asks for it. */
function converted(schema: StandardSchemaV1, io: 'input' | 'output') {
  const props: Partial<StandardJSONSchemaV1.Props> = schema['~standard']
  if (props.jsonSchema === undefined) throw new Error('the schema has no JSON Schema')
  const json = props.jsonSchema[io]({ target: 'draft-2020-12' })
  return Object.fromEntries(Object.entries(json).filter(([k]) => k !== '$schema'))
}

describe('the op pipeline', () => {
  let db: ClosableDbPort
  let hub: Hub
  let token: string
  let paths: Paths
  const errors: unknown[] = []
  const ajv = new Ajv2020({ strict: false, validateFormats: false })

  beforeAll(async () => {
    db = pgliteDb()
    hub = assembleHub(
      {
        config: { bootstrapToken },
        ports: { db, edgeIdentity: noEdgeIdentity() },
        modules: [replies],
        onError: (error) => errors.push(error),
      },
      extra,
    )
    await hub.migrate()
    await hub.boot()
    // Not an admin, so bootstrap stays open for its own case.
    await db.privileged((tx) => tx.insert(users).values({ id: 'bob', name: 'bob', admin: false }))
    const scopes = ['self:manage', 'sql:read', 'replies:write'] as const
    token = (await hub.directory.issueToken('bob', { kind: 'management', scopes: [...scopes] }))
      .token
    const document = (await (await call('GET', '/api/v1/openapi.json')).json()) as {
      paths: Paths
    }
    paths = document.paths
  }, 60_000)

  afterAll(() => db.close())

  function call(method: string, path: string, body?: unknown, bearer = token) {
    return hub.fetch(
      new Request(new URL(path, 'http://hub.test'), {
        method,
        headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    )
  }

  describe.each([
    {
      name: 'a fixture core op',
      path: '/api/v1/fixture/echo',
      bearer: () => token,
      rejected: [{}, { name: '' }, { name: 3 }, { name: 'a', count: 1.5 }, { name: 'a', more: 1 }],
      accepted: [{ name: 'a' }, { name: 'a', count: 2 }],
    },
    {
      name: 'sql',
      path: '/api/v1/sql',
      bearer: () => token,
      rejected: [{}, { sql: '' }, { sql: 'select 1', params: [{}] }, { sql: 'select 1', x: 1 }],
      accepted: [{ sql: 'select 1 as one' }, { sql: 'select $1::int as n', params: [1] }],
    },
    {
      name: 'bootstrap',
      path: '/api/v1/bootstrap',
      bearer: () => bootstrapToken,
      rejected: [{ name: '' }, { name: 5 }, { name: 'Ada', admin: true }],
      // The first accepted body bootstraps the Hub; so there is only one.
      accepted: [{ name: 'Ada' }],
    },
  ])('$name', ({ path, bearer, rejected, accepted }) => {
    const documented = () => {
      const post = paths[path]?.post as {
        requestBody: { content: { 'application/json': { schema: object } } }
        responses: Record<string, { content?: { 'application/json': { schema: object } } }>
      }
      return {
        request: post.requestBody.content['application/json'].schema,
        response: post.responses['200']?.content?.['application/json'].schema ?? {},
      }
    }

    it('documents the schemas it validates with', () => {
      const defined = hubOps([], extra).find((o) => o.path === path)
      if (defined?.kind !== 'typed') throw new Error(`no typed op at ${path}`)
      expect(documented().request).toEqual(converted(defined.input, 'input'))
      expect(documented().response).toEqual(converted(defined.output, 'output'))
    })

    it('rejects with 400 a body the document rejects, and accepts one it accepts', async () => {
      const { request, response } = documented()
      const accepts = ajv.compile(request)
      const answers = ajv.compile(response)
      for (const body of rejected) {
        expect(accepts(body), JSON.stringify(body)).toBe(false)
        expect((await call('POST', path, body, bearer())).status, JSON.stringify(body)).toBe(400)
      }
      for (const body of accepted) {
        expect(accepts(body), JSON.stringify(body)).toBe(true)
        const answered = await call('POST', path, body, bearer())
        expect(answered.status, JSON.stringify(body)).toBe(200)
        expect(answers(await answered.json())).toBe(true)
      }
    })
  })

  describe.each([
    { kind: 'a core op', path: '/api/v1/fixture/reply', name: 'core.reply', module: undefined },
    {
      kind: 'a Module op',
      path: '/api/v1/replies/reply',
      name: 'replies.reply',
      module: 'replies',
    },
  ])('the reply sequence for $kind', ({ path, name, module }) => {
    it('answers a status the op does not declare with a 500 problem naming the op', async () => {
      const before = errors.length
      const answered = await call('POST', path, { mode: 'undeclared' })
      expect(answered.status).toBe(500)
      expect(answered.headers.get('content-type')).toBe('application/problem+json')
      expect(await answered.json()).toMatchObject({
        type: 'urn:embertrail:problem:internal',
        detail: `op "${name}" answered 201, not in its statuses`,
        ...(module === undefined ? {} : { module }),
      })
      expect(errors.length).toBe(before + 1)
    })

    it('sends 204 with no body', async () => {
      const answered = await call('POST', path, { mode: 'empty' })
      expect(answered.status).toBe(204)
      expect(await answered.text()).toBe('')
    })

    it('sends the ETag the op returns', async () => {
      const answered = await call('POST', path, { mode: 'tagged' })
      expect(answered.status).toBe(200)
      expect(answered.headers.get('etag')).toBe('"v1"')
      expect(await answered.json()).toEqual({ ok: true })
    })
  })
})
