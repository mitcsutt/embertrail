// `PUT /api/v1/sessions/{session_id}/labels`: replaces the caller's Owner's Labels for a
// Session. Accepted before the Session's first Signal, since exporters flush on exit.

import type { Ctx } from '@mitcsutt/embertrail-hub'
import { and, eq, sql } from 'drizzle-orm'

import { sessionLabels } from '../schema'

export async function putLabels(
  { db, caller, now }: Ctx,
  sessionId: string,
  labels: Record<string, string>,
) {
  if (Object.keys(labels).length === 0) {
    // An empty set clears it. Row-level security limits the delete to the caller's Owner.
    await db
      .delete(sessionLabels)
      .where(and(eq(sessionLabels.sessionId, sessionId), eq(sessionLabels.ownerId, caller.ownerId)))
    return { session_id: sessionId, labels }
  }
  await db
    .insert(sessionLabels)
    .values({ sessionId, labels, updatedAt: now().toISOString() })
    .onConflictDoUpdate({
      target: [sessionLabels.ownerId, sessionLabels.sessionId],
      set: { labels: sql`excluded.labels`, updatedAt: sql`excluded.updated_at` },
    })
  return { session_id: sessionId, labels }
}
