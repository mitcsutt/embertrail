import { randomUUID } from 'node:crypto'

import type { ClosableDbPort } from '@mitcsutt/embertrail-hub/testing'
import pg from 'pg'

import { dockerDb } from '../db'

async function run(serverUrl: string, statement: string) {
  const client = new pg.Client({ connectionString: serverUrl })
  await client.connect()
  try {
    await client.query(statement)
  } finally {
    await client.end()
  }
}

/**
 * Opens the Docker Db Adapter on a fresh database on the server at `serverUrl`, and drops
 * the database on close. Each check gets its own, so checks never share Module schemas.
 */
export async function openTempDb(serverUrl: string, poolSize = 3): Promise<ClosableDbPort> {
  const name = `embertrail_test_${randomUUID().replaceAll('-', '')}`
  await run(serverUrl, `create database ${name}`)
  const url = new URL(serverUrl)
  url.pathname = `/${name}`
  const port = dockerDb({ url: url.toString(), poolSize })
  return {
    ...port,
    async close() {
      await port.close()
      await run(serverUrl, `drop database if exists ${name} with (force)`)
    },
  }
}
