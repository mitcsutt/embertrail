import { pgTable, serial } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { defineModule, moduleSchema, op } from '../module/define'
import type { Module, ModuleDef, OwnedTable } from '../module/define'
import { createHub, migrateModules } from './create-hub'
import { noEdgeIdentity } from '../identity/edge'
import type { DbPort } from '../db/port'
import type { HubConfig } from './boot'

const unusedDb: DbPort = {
  transaction: () => Promise.reject(new Error('no database in static boot tests')),
  privileged: () => Promise.reject(new Error('no database in static boot tests')),
}

function boot(modules: readonly Module[], config: HubConfig = {}) {
  return () =>
    createHub({ config, ports: { db: unusedDb, edgeIdentity: noEdgeIdentity() }, modules })
}

const ping = (path = '/api/v1/alpha/ping', scope?: `${string}:${string}`) =>
  op.query({
    method: 'GET',
    path,
    summary: 'Ping',
    input: z.object({}),
    output: z.object({ ok: z.boolean() }),
    ...(scope === undefined ? {} : { scope }),
    run: () => Promise.resolve({ ok: true }),
  })

function module<N extends string>(name: N, overrides: Partial<ModuleDef<N>> = {}) {
  return defineModule({ contract: 1, name, tables: {}, migrations: [], ops: {}, ...overrides })
}

describe('boot', () => {
  it('accepts valid Modules and derives their Scopes', () => {
    const hub = boot([module('alpha', { ops: { ping: ping() } })])()
    expect(hub.scopes).toEqual(['alpha:read', 'admin', 'self:manage', 'sql:read'])
  })

  it('refuses invalid config', () => {
    expect(boot([], { retentionDays: 0 })).toThrow(/^Hub config: invalid config: /)
    expect(boot([], { retentionDays: 3, nope: true } as HubConfig)).toThrow(
      /^Hub config: invalid config: .*nope/s,
    )
  })

  it('refuses an unknown contract', () => {
    const future = { ...module('alpha'), contract: 2 } as unknown as Module
    expect(boot([future])).toThrow(
      'Module "alpha": unknown contract: contract 2 is not supported; this Hub implements contract 1',
    )
  })

  it.each(['Alpha', 'core', 'public', 'pg_stats', '9lives', 'has-dash'])(
    'refuses the Module name %s',
    (name) => {
      expect(boot([module(name)])).toThrow(`Module "${name}": invalid name: `)
    },
  )

  it('refuses two Modules with one name', () => {
    expect(boot([module('alpha'), module('alpha')])).toThrow(
      'Module "alpha": duplicate name: two Modules share this name',
    )
  })

  it('refuses a table not built with ownedTable', () => {
    const plain = pgTable('plain', { id: serial('id') }) as unknown as OwnedTable
    expect(boot([module('alpha', { tables: { plain } })])).toThrow(
      'Module "alpha": not an owned table: table "plain" was not built with moduleSchema("alpha").ownedTable',
    )
  })

  it('refuses a table in another Module’s schema', () => {
    const items = moduleSchema('beta').ownedTable('items', { id: serial('id') })
    expect(boot([module('alpha', { tables: { items } })])).toThrow(
      'Module "alpha": table outside schema: table beta.items must live in schema "alpha"',
    )
  })

  it('refuses a cross-Module Scope claim', () => {
    const thief = module('alpha', { ops: { steal: ping('/api/v1/alpha/steal', 'beta:read') } })
    expect(boot([thief, module('beta')])).toThrow(
      'Module "alpha": scope outside prefix: op "steal" claims Scope "beta:read"; a Module may only use "alpha:<verb>" or "admin"',
    )
  })

  it('accepts a narrowed Scope within the prefix, and admin', () => {
    const narrowed = module('alpha', {
      ops: {
        ping: ping('/api/v1/alpha/ping', 'alpha:ping'),
        admin: op.mutate({
          method: 'POST',
          path: '/api/v1/alpha/admin',
          summary: 'Admin only',
          scope: 'admin',
          input: z.object({}),
          output: z.object({}),
          run: () => Promise.resolve({}),
        }),
      },
    })
    expect(boot([narrowed])().scopes).toEqual(['alpha:ping', 'admin', 'self:manage', 'sql:read'])
  })

  it('refuses an empty verb', () => {
    expect(boot([module('alpha', { ops: { p: ping('/api/v1/alpha/p', 'alpha:') } })])).toThrow(
      'Module "alpha": scope outside prefix: ',
    )
  })

  it('refuses a malformed path', () => {
    expect(boot([module('alpha', { ops: { p: ping('api/v1/alpha') } })])).toThrow(
      'Module "alpha": invalid path: op "p" has path "api/v1/alpha"; use /segments and {params}',
    )
  })

  it('refuses a duplicate path across Modules, whatever the parameter names', () => {
    const a = module('alpha', { ops: { one: ping('/api/v1/things/{id}') } })
    const b = module('beta', { ops: { two: ping('/api/v1/things/{thing}') } })
    expect(boot([a, b])).toThrow(
      'Module "beta": duplicate path: op "two" (GET /api/v1/things/{thing}) collides with a route of Module "alpha"',
    )
  })

  it('refuses a path the core serves', () => {
    expect(boot([module('alpha', { ops: { doc: ping('/api/v1/openapi.json') } })])).toThrow(
      'Module "alpha": duplicate path: op "doc" (GET /api/v1/openapi.json) collides with a route of the core',
    )
  })

  it('refuses a path the core serves before migrating', () => {
    const touched: string[] = []
    const db: DbPort = {
      transaction: () => (
        touched.push('transaction'),
        unusedDb.transaction(undefined as never, undefined as never)
      ),
      privileged: () => (touched.push('privileged'), unusedDb.privileged(undefined as never)),
    }
    const clash = module('alpha', { ops: { doc: ping('/api/v1/openapi.json') } })
    expect(() => migrateModules(db, [clash])).toThrow('duplicate path')
    expect(touched).toEqual([])
  })

  it('refuses a schema with no JSON Schema converter', () => {
    const opaque = {
      '~standard': { version: 1, vendor: 'opaque', validate: (value: unknown) => ({ value }) },
    } as const
    const bad = op.query({
      method: 'GET',
      path: '/api/v1/alpha/opaque',
      summary: 'Opaque',
      input: opaque,
      output: z.object({}),
      run: () => Promise.resolve({}),
    })
    expect(boot([module('alpha', { ops: { bad } })])).toThrow(
      'Module "alpha": no JSON Schema: op "bad" input: the schema has no JSON Schema converter; use a Standard JSON Schema library',
    )
  })

  it('refuses an unknown dependency', () => {
    expect(boot([module('alpha', { dependsOn: ['ghost'] })])).toThrow(
      'Module "alpha": unknown dependency: dependsOn names "ghost", which this Hub doesn\'t load',
    )
  })

  it('refuses a dependsOn cycle', () => {
    const a = module('alpha', { dependsOn: ['beta'] })
    const b = module('beta', { dependsOn: ['gamma'] })
    const c = module('gamma', { dependsOn: ['alpha'] })
    expect(boot([a, b, c])).toThrow(
      'Module "alpha": dependsOn cycle: dependsOn forms a cycle: alpha -> beta -> gamma -> alpha',
    )
  })

  it('refuses a retention column no table has', () => {
    const items = moduleSchema('alpha').ownedTable('items', { id: serial('id') })
    expect(
      boot([module('alpha', { tables: { items }, retention: { column: 'created_at' } })]),
    ).toThrow('Module "alpha": retention column: no table has the retention column "created_at"')
  })
})
