import { drizzleDbPort } from '@mitcsutt/embertrail-hub'
import type { DbPort } from '@mitcsutt/embertrail-hub'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'

export interface CloudflareDbOptions {
  /** The Hyperdrive binding's `connectionString` (`env.HYPERDRIVE.connectionString`). */
  connectionString: string
}

/**
 * The Cloudflare Db Adapter (#26, #38): one `pg.Client` per call. A Worker must not keep an I/O
 * object across requests, so there is no pool and no client at module scope. Each
 * `transaction` or `privileged` call connects (cheap, through Hyperdrive), runs the Docker
 * Adapter's transaction logic on that client, and ends the client in `finally`.
 */
export function cloudflareDb({ connectionString }: CloudflareDbOptions): DbPort {
  async function withClient<T>(work: (port: DbPort) => Promise<T>): Promise<T> {
    const client = new pg.Client({ connectionString })
    let ending = false
    // An error between queries (a dropped socket) has no caller to reject to; unhandled, the
    // client's error event would throw inside the isolate. Closing the socket makes
    // pg-cloudflare's pending read fail with "This socket has been closed", which is not one.
    client.on('error', (error) => {
      if (!ending) console.error('[embertrail] Postgres connection failed:', error)
    })
    await client.connect()
    try {
      return await work(drizzleDbPort(drizzle({ client })))
    } finally {
      ending = true
      // The call's own result or error wins; a failed close of a broken connection is noise.
      await client.end().catch(() => undefined)
    }
  }

  return {
    transaction: (session, fn) => withClient((port) => port.transaction(session, fn)),
    privileged: (fn) => withClient((port) => port.privileged(fn)),
  }
}
