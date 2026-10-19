// Generated from spec/query-api.yaml by scripts/generate.ts. Do not edit:
// change the spec, then run `pnpm --filter @mitcsutt/embertrail-client generate`.

import type { operations } from './schema.ts'

/** Every problem `type` the spec lists. New types may be added within v1. */
export const problemTypes = [
  'urn:embertrail:problem:validation',
  'urn:embertrail:problem:invalid-cursor',
  'urn:embertrail:problem:unauthenticated',
  'urn:embertrail:problem:forbidden',
  'urn:embertrail:problem:identity-conflict',
  'urn:embertrail:problem:not-found',
  'urn:embertrail:problem:conflict',
  'urn:embertrail:problem:precondition-failed',
  'urn:embertrail:problem:payload-too-large',
  'urn:embertrail:problem:invalid',
  'urn:embertrail:problem:too-many-rows',
  'urn:embertrail:problem:query-timeout',
  'urn:embertrail:problem:sql-error',
  'urn:embertrail:problem:internal',
] as const

/** How to call each operation: method, path template and the response headers it returns. */
export const operationTable = {
  queryMetrics: { method: 'POST', path: '/api/v1/metrics/query', responseHeaders: [] },
  queryEvents: { method: 'POST', path: '/api/v1/events/query', responseHeaders: [] },
  listSessions: { method: 'GET', path: '/api/v1/sessions', responseHeaders: [] },
  getSession: { method: 'GET', path: '/api/v1/sessions/{session_id}', responseHeaders: [] },
  putSessionLabels: {
    method: 'PUT',
    path: '/api/v1/sessions/{session_id}/labels',
    responseHeaders: [],
  },
  getInventory: { method: 'GET', path: '/api/v1/inventory', responseHeaders: [] },
  runSql: { method: 'POST', path: '/api/v1/sql', responseHeaders: [] },
  listStoreDocuments: { method: 'GET', path: '/api/v1/store/{namespace}', responseHeaders: [] },
  getStoreDocument: {
    method: 'GET',
    path: '/api/v1/store/{namespace}/{id}',
    responseHeaders: ['ETag'],
  },
  putStoreDocument: {
    method: 'PUT',
    path: '/api/v1/store/{namespace}/{id}',
    responseHeaders: ['ETag'],
  },
  deleteStoreDocument: {
    method: 'DELETE',
    path: '/api/v1/store/{namespace}/{id}',
    responseHeaders: [],
  },
  getOpenApi: { method: 'GET', path: '/api/v1/openapi.json', responseHeaders: [] },
} as const

/** Each operation's input (path, query, header, body) and resolved output. */
export interface Operations {
  /**
   * Aggregate one Metric, optionally grouped and bucketed
   *
   * `POST /api/v1/metrics/query`
   */
  queryMetrics: {
    input: {
      body: NonNullable<operations['queryMetrics']['requestBody']>['content']['application/json']
    }
    output: operations['queryMetrics']['responses'][200]['content']['application/json']
  }
  /**
   * List Events, or aggregate them
   *
   * `POST /api/v1/events/query`
   */
  queryEvents: {
    input: {
      body: NonNullable<operations['queryEvents']['requestBody']>['content']['application/json']
    }
    output: operations['queryEvents']['responses'][200]['content']['application/json']
  }
  /**
   * List Sessions
   *
   * `GET /api/v1/sessions`
   */
  listSessions: {
    input?: { query?: NonNullable<operations['listSessions']['parameters']['query']> }
    output: operations['listSessions']['responses'][200]['content']['application/json']
  }
  /**
   * Get one Session with its direct children
   *
   * `GET /api/v1/sessions/{session_id}`
   */
  getSession: {
    input: { path: NonNullable<operations['getSession']['parameters']['path']> }
    output: operations['getSession']['responses'][200]['content']['application/json']
  }
  /**
   * Replace a Session's labels
   *
   * `PUT /api/v1/sessions/{session_id}/labels`
   */
  putSessionLabels: {
    input: {
      path: NonNullable<operations['putSessionLabels']['parameters']['path']>
      body: NonNullable<
        operations['putSessionLabels']['requestBody']
      >['content']['application/json']
    }
    output: operations['putSessionLabels']['responses'][200]['content']['application/json']
  }
  /**
   * List what exists in the visible data
   *
   * `GET /api/v1/inventory`
   */
  getInventory: {
    input?: { query?: NonNullable<operations['getInventory']['parameters']['query']> }
    output: operations['getInventory']['responses'][200]['content']['application/json']
  }
  /**
   * Run one read-only SQL statement
   *
   * `POST /api/v1/sql`
   */
  runSql: {
    input: { body: NonNullable<operations['runSql']['requestBody']>['content']['application/json'] }
    output: operations['runSql']['responses'][200]['content']['application/json']
  }
  /**
   * List documents in a namespace
   *
   * `GET /api/v1/store/{namespace}`
   */
  listStoreDocuments: {
    input: {
      path: NonNullable<operations['listStoreDocuments']['parameters']['path']>
      query?: NonNullable<operations['listStoreDocuments']['parameters']['query']>
    }
    output: operations['listStoreDocuments']['responses'][200]['content']['application/json']
  }
  /**
   * Get one document
   *
   * `GET /api/v1/store/{namespace}/{id}`
   */
  getStoreDocument: {
    input: { path: NonNullable<operations['getStoreDocument']['parameters']['path']> }
    output: {
      data: operations['getStoreDocument']['responses'][200]['content']['application/json']
      headers: { ETag: string | null }
    }
  }
  /**
   * Create or replace a document
   *
   * `PUT /api/v1/store/{namespace}/{id}`
   */
  putStoreDocument: {
    input: {
      path: NonNullable<operations['putStoreDocument']['parameters']['path']>
      header?: NonNullable<operations['putStoreDocument']['parameters']['header']>
      body: NonNullable<
        operations['putStoreDocument']['requestBody']
      >['content']['application/json']
    }
    output: {
      data:
        | operations['putStoreDocument']['responses'][200]['content']['application/json']
        | operations['putStoreDocument']['responses'][201]['content']['application/json']
      headers: { ETag: string | null }
    }
  }
  /**
   * Delete a document
   *
   * `DELETE /api/v1/store/{namespace}/{id}`
   */
  deleteStoreDocument: {
    input: {
      path: NonNullable<operations['deleteStoreDocument']['parameters']['path']>
      header?: NonNullable<operations['deleteStoreDocument']['parameters']['header']>
    }
    output: undefined
  }
  /**
   * This document, as assembled from the running Hub's Modules
   *
   * `GET /api/v1/openapi.json`
   */
  getOpenApi: {
    input?: Record<never, never>
    output: operations['getOpenApi']['responses'][200]['content']['application/json']
  }
}
