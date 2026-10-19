import { drizzleDbPort } from '@mitcsutt/embertrail-hub'
import type { DbPort } from '@mitcsutt/embertrail-hub'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'

export interface DockerDbOptions {
  /** The Postgres connection string, `DATABASE_URL`. */
  url: string
  /** Connections in the pool, `DATABASE_POOL_SIZE`. Default 10. */
  poolSize?: number
}

/**
 * The Docker Db Adapter (#26): a `pg` pool. Each transaction takes one pooled connection and
 * releases it when it ends, so the pool never carries one request's session into another.
 */
export function dockerDb({ url, poolSize = 10 }: DockerDbOptions): DbPort & {
  close(): Promise<void>
} {
  const pool = new pg.Pool({ connectionString: url, max: poolSize })
  // An idle connection can drop; unhandled, the pool's error event would end the process.
  pool.on('error', (error) => {
    console.error('[embertrail] idle Postgres connection failed:', error)
  })
  return { ...drizzleDbPort(drizzle({ client: pool })), close: () => pool.end() }
}
