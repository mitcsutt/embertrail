import pg from 'pg'

import { databaseUrl, scratchDatabase } from './postgres'

async function run(statement: string) {
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    await client.query(statement)
  } finally {
    await client.end()
  }
}

// workerd cannot create a database through Hyperdrive's one fixed connection string, so Node
// creates the scratch database the binding points at and drops it when the run ends.
export async function setup() {
  if (databaseUrl === '') return
  await run(`create database ${scratchDatabase}`)
}

export async function teardown() {
  if (databaseUrl === '') return
  await run(`drop database if exists ${scratchDatabase} with (force)`)
}
