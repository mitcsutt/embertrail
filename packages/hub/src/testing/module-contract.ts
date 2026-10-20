import assert from 'node:assert/strict'

import { sql } from 'drizzle-orm'

import { declaredTables, ident } from '../db/migrate'
import { rows } from '../db/port'
import type { DbSession } from '../db/port'
import { opScope } from '../module/define'
import type { Module } from '../module/define'
import type { ClosableDbPort } from './pglite'
import { testHub } from './test-hub'
import type { TestClient } from './test-hub'

export interface ModuleContractOptions {
  /**
   * Writes data through the Module's ops. `client` holds every Scope the Module derives on a
   * Token bound to a Source, and adds a forged `owner_id` and `source_id` to every request.
   */
  seed(client: TestClient): Promise<void>
  /** Defaults to PGLite; pass a Postgres Adapter to run the suite on a server. */
  db?: ClosableDbPort
}

const owner = 'contract-owner'
const source = 'contract-source'
const stranger = 'contract-stranger'
const admin = 'contract-admin'
const forged = { owner_id: 'contract-forger', source_id: 'contract-forged-source' }

/** Wraps a client so every request also carries a forged owner_id and source_id. */
function forging(client: TestClient): TestClient {
  const withForgedQuery = (path: string) => {
    const url = new URL(path, 'http://hub.test')
    for (const [key, value] of Object.entries(forged)) url.searchParams.set(key, value)
    return `${url.pathname}${url.search}`
  }
  const withForgedBody = (body: unknown) =>
    typeof body === 'object' && body !== null && !Array.isArray(body)
      ? { ...body, ...forged }
      : body
  return {
    fetch: (path, init) => client.fetch(withForgedQuery(path), init),
    get: (path) => client.get(withForgedQuery(path)),
    post: (path, body) => client.post(withForgedQuery(path), withForgedBody(body)),
    put: (path, body) => client.put(withForgedQuery(path), withForgedBody(body)),
    delete: (path) => client.delete(withForgedQuery(path)),
  }
}

/**
 * The contract every Module passes for free (#25): caller-supplied ownership is ignored, no
 * cross-Owner reads without a Grant, export covers every owned row, delete-by-Source and
 * delete-by-Owner leave nothing behind, and every op is in the OpenAPI document. Throws on
 * the first failure.
 */
export async function assertModuleContract(module: Module, options: ModuleContractOptions) {
  const t = await testHub({ modules: [module], ...(options.db ? { db: options.db } : {}) })
  try {
    const tables = declaredTables(module).map((table) => ({
      ...table,
      qualified: sql.raw(`${ident(module.name)}.${ident(table.name)}`),
    }))
    const stamps = async () => {
      const found: { table: string; owner_id: string; source_id: string | null }[] = []
      for (const table of tables) {
        const column = sql.raw(table.signal ? 'source_id' : 'null::text')
        const stamped = await t.sql<{ owner_id: string; source_id: string | null }>(
          sql`select owner_id, ${column} as source_id from ${table.qualified}`,
        )
        found.push(...stamped.map((row) => ({ table: table.name, ...row })))
      }
      return found
    }

    await options.seed(forging(t.as(owner, module.scopes, { sourceId: source })))
    assert.deepEqual(t.errors, [], 'seeding answered with a 500')
    const seeded = await stamps()
    assert.ok(seeded.length > 0, 'seed wrote no rows, so the contract proves nothing')
    for (const row of seeded) {
      assert.equal(row.owner_id, owner, `${row.table}: a caller-supplied owner_id was stored`)
      if (row.source_id !== null) {
        assert.equal(row.source_id, source, `${row.table}: a caller-supplied source_id was stored`)
      }
    }

    for (const role of ['app', 'readonly'] as const) {
      const session: DbSession = { role, userId: stranger, ownerId: stranger }
      for (const table of tables) {
        const [visible] = await t.db.transaction(session, (db) =>
          rows<{ count: number }>(db, sql`select count(*)::int as count from ${table.qualified}`),
        )
        assert.equal(visible?.count, 0, `${table.name}: another Owner can read rows (${role})`)
      }
    }

    const exported = (await t.hub.exportOwner(module.name, owner)).split('\n').filter(Boolean)
    for (const line of exported) JSON.parse(line)
    if (module.export === undefined) {
      assert.equal(exported.length, seeded.length, 'export is missing owned rows')
    } else {
      assert.ok(exported.length > 0, 'export is empty')
    }

    // Deletes go through the Admin and self-management API (#30), which uses delete-by-Source
    // and delete-by-Owner, so the suite proves what a User or an admin actually calls.
    const signalRows = seeded.filter((row) => row.source_id !== null).length
    const deletedSource = await t
      .as(owner, ['self:manage'])
      .delete(`/api/v1/self/sources/${source}`)
    assert.equal(deletedSource.status, 204, 'deleting the Source through the API')
    const afterSource = await stamps()
    assert.equal(
      afterSource.filter((row) => row.source_id === source).length,
      0,
      'delete-by-Source left rows',
    )
    assert.equal(afterSource.length, seeded.length - signalRows, 'delete-by-Source count')
    const deletedOwner = await t.as(admin, ['admin']).delete(`/api/v1/admin/users/${owner}`)
    assert.equal(deletedOwner.status, 204, 'deleting the Owner through the Admin API')
    assert.equal((await stamps()).length, 0, 'delete-by-Owner left rows')
    assert.deepEqual(t.errors, [], 'deleting answered with a 500')

    const document = JSON.parse(JSON.stringify(t.hub.openapi)) as typeof t.hub.openapi
    for (const [key, op] of Object.entries(module.ops)) {
      const operation = document.paths[op.path]?.[op.method.toLowerCase()] as
        Record<string, unknown> | undefined
      assert.ok(operation, `op "${key}" is missing from the OpenAPI document`)
      assert.equal(operation['x-embertrail-scope'], opScope(module.name, op))
      assert.equal(operation['x-embertrail-module'], module.name)
    }
  } finally {
    await t.close()
  }
}
