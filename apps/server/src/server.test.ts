import { randomUUID } from 'node:crypto'

import { createHub, noEdgeIdentity } from '@mitcsutt/embertrail-hub'
import pg from 'pg'
import { afterEach, describe, expect, it } from 'vitest'

import { dockerDb } from './db'
import { hubModules } from './modules'
import { startServer } from './server'
import type { RunningServer } from './server'
import { databaseUrl, skipWithoutPostgres } from './testing/postgres'

// The Docker Platform end to end on Postgres 17: boot, listen, and the zero-config start (#37).
// Skipped locally without DATABASE_URL, as db.test.ts is.
describe.skipIf(skipWithoutPostgres)('the Docker server', () => {
  const running: RunningServer[] = []
  const databases: string[] = []

  async function admin(statement: string) {
    const client = new pg.Client({ connectionString: databaseUrl })
    await client.connect()
    try {
      await client.query(statement)
    } finally {
      await client.end()
    }
  }

  /** A fresh, migrated database; returns its URL. */
  async function freshDatabase() {
    const name = `embertrail_server_${randomUUID().replaceAll('-', '')}`
    await admin(`create database ${name}`)
    databases.push(name)
    const url = new URL(databaseUrl)
    url.pathname = `/${name}`
    const db = dockerDb({ url: url.toString(), poolSize: 1 })
    try {
      await createHub({
        config: {},
        ports: { db, edgeIdentity: noEdgeIdentity() },
        modules: hubModules,
      }).migrate()
    } finally {
      await db.close()
    }
    return url.toString()
  }

  async function start(env: Record<string, string>) {
    const lines: string[] = []
    const server = await startServer({
      env: { PORT: '0', HOST: '127.0.0.1', ...env },
      log: (line) => lines.push(line),
    })
    running.push(server)
    return { server, lines, token: lines.find((line) => /^\s+et_/.test(line))?.trim() }
  }

  afterEach(async () => {
    await Promise.all(running.splice(0).map((server) => server.close()))
    await Promise.all(
      databases.splice(0).map((name) => admin(`drop database ${name} with (force)`)),
    )
  })

  it('creates one admin User and prints a working management Token once', async () => {
    const url = await freshDatabase()
    const first = await start({ DATABASE_URL: url })
    expect(first.token).toMatch(/^et_[a-z0-9]{16}_[A-Za-z0-9]{40}$/)

    const hub = `http://127.0.0.1:${String(first.server.port)}`
    const me = await fetch(`${hub}/api/v1/self/sources`, {
      headers: { authorization: `Bearer ${first.token ?? ''}` },
    })
    expect(me.status).toBe(200)

    // A restart finds the User: no second one, no second Token in the log.
    await first.server.close()
    running.pop()
    const second = await start({ DATABASE_URL: url })
    expect(second.token).toBeUndefined()
    expect(second.lines.join('\n')).not.toContain('et_')
    expect(await second.server.hub.directory.users()).toHaveLength(1)
  })

  it('leaves bootstrap to BOOTSTRAP_TOKEN when it is set', async () => {
    const url = await freshDatabase()
    const bootstrapToken = 'b'.repeat(40)
    const { server, token } = await start({ DATABASE_URL: url, BOOTSTRAP_TOKEN: bootstrapToken })
    expect(token).toBeUndefined()
    expect(await server.hub.directory.users()).toEqual([])

    const response = await fetch(`http://127.0.0.1:${String(server.port)}/api/v1/bootstrap`, {
      method: 'POST',
      headers: { authorization: `Bearer ${bootstrapToken}` },
    })
    expect(response.status).toBe(200)
  })

  it('refuses to start on a database nobody migrated', async () => {
    const name = `embertrail_server_${randomUUID().replaceAll('-', '')}`
    await admin(`create database ${name}`)
    databases.push(name)
    const url = new URL(databaseUrl)
    url.pathname = `/${name}`
    await expect(start({ DATABASE_URL: url.toString() })).rejects.toThrow()
  })
})
