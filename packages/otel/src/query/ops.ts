// The otel Query API (#33) as ops: plain functions bound to REST paths, so another transport
// can bind them later unchanged (#25).

import { op } from '@mitcsutt/embertrail-hub'
import { z } from 'zod'

import { aggregateEvents, listEvents } from './events'
import { inventory } from './inventory'
import { putLabels } from './labels'
import { queryMetrics } from './metrics'
import * as schemas from './schemas'
import { getSession, listSessionSummaries } from './sessions'

export const queryOps = {
  queryMetrics: op.query({
    method: 'POST',
    path: '/api/v1/metrics/query',
    summary: 'Aggregate one Metric, optionally grouped and bucketed',
    input: schemas.metricsQuery,
    output: schemas.aggregateResult,
    run: (query, { db }) => queryMetrics(db, query),
  }),
  queryEvents: op.query({
    method: 'POST',
    path: '/api/v1/events/query',
    summary: 'List Events, or aggregate them',
    input: schemas.eventsQuery,
    output: z.union([schemas.eventList, schemas.aggregateResult]),
    run: (query, { db }) =>
      query.mode === 'list' ? listEvents(db, query) : aggregateEvents(db, query),
  }),
  listSessions: op.query({
    method: 'GET',
    path: '/api/v1/sessions',
    summary: 'List Sessions',
    input: schemas.listSessions,
    output: z.object({
      items: z.array(schemas.sessionSummary),
      next_cursor: z.string().nullable(),
    }),
    run: (query, { db }) => listSessionSummaries(db, query),
  }),
  getSession: op.query({
    method: 'GET',
    path: '/api/v1/sessions/{session_id}',
    summary: 'Get one Session with its direct children',
    input: z.object({ session_id: schemas.sessionId }),
    output: schemas.sessionDetail,
    run: ({ session_id: id }, { db, caller }) => getSession(db, id, caller.ownerId),
  }),
  putSessionLabels: op.mutate({
    method: 'PUT',
    path: '/api/v1/sessions/{session_id}/labels',
    summary: "Replace a Session's Labels",
    input: z.strictObject({ session_id: schemas.sessionId, labels: schemas.labels }),
    output: z.object({ session_id: z.string(), labels: schemas.labels }),
    run: ({ session_id: id, labels }, ctx) => putLabels(ctx, id, labels),
  }),
  getInventory: op.query({
    method: 'GET',
    path: '/api/v1/inventory',
    summary: 'List what exists in the visible data',
    input: z.strictObject({ from: schemas.timestamp.optional(), to: schemas.timestamp.optional() }),
    output: schemas.inventory,
    run: (range, ctx) => inventory(ctx, range),
  }),
}
