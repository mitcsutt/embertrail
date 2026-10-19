import type { ScopedDb } from '@mitcsutt/embertrail-hub'
import type { SQL } from 'drizzle-orm'

/** Runs raw SQL and returns its rows, whichever driver is underneath. */
export async function rows<T>(db: ScopedDb, query: SQL): Promise<T[]> {
  const result: unknown = await db.execute(query)
  return (result as { rows: T[] }).rows
}

/** A query without its paging keys, so a cursor can be tied to the query that issued it. */
export function withoutPaging(query: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(query).filter(([key]) => key !== 'cursor' && key !== 'limit'),
  )
}
