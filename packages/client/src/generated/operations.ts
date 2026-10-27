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
  bootstrap: { method: 'POST', path: '/api/v1/bootstrap', responseHeaders: [] },
  listUsers: { method: 'GET', path: '/api/v1/admin/users', responseHeaders: [] },
  createUser: { method: 'POST', path: '/api/v1/admin/users', responseHeaders: [] },
  deleteUser: { method: 'DELETE', path: '/api/v1/admin/users/{user_id}', responseHeaders: [] },
  listTeams: { method: 'GET', path: '/api/v1/admin/teams', responseHeaders: [] },
  createTeam: { method: 'POST', path: '/api/v1/admin/teams', responseHeaders: [] },
  deleteTeam: { method: 'DELETE', path: '/api/v1/admin/teams/{team_id}', responseHeaders: [] },
  setTeamMember: {
    method: 'PUT',
    path: '/api/v1/admin/teams/{team_id}/members/{user_id}',
    responseHeaders: [],
  },
  removeTeamMember: {
    method: 'DELETE',
    path: '/api/v1/admin/teams/{team_id}/members/{user_id}',
    responseHeaders: [],
  },
  listAllSources: { method: 'GET', path: '/api/v1/admin/sources', responseHeaders: [] },
  deleteAnySource: {
    method: 'DELETE',
    path: '/api/v1/admin/sources/{source_id}',
    responseHeaders: [],
  },
  getSelf: { method: 'GET', path: '/api/v1/self', responseHeaders: [] },
  getRates: { method: 'GET', path: '/api/v1/rates', responseHeaders: [] },
  listSources: { method: 'GET', path: '/api/v1/self/sources', responseHeaders: [] },
  createSource: { method: 'POST', path: '/api/v1/self/sources', responseHeaders: [] },
  renameSource: { method: 'PUT', path: '/api/v1/self/sources/{source_id}', responseHeaders: [] },
  deleteSource: { method: 'DELETE', path: '/api/v1/self/sources/{source_id}', responseHeaders: [] },
  listTokens: { method: 'GET', path: '/api/v1/self/tokens', responseHeaders: [] },
  issueToken: { method: 'POST', path: '/api/v1/self/tokens', responseHeaders: [] },
  revokeToken: { method: 'DELETE', path: '/api/v1/self/tokens/{token_id}', responseHeaders: [] },
  listAccounts: { method: 'GET', path: '/api/v1/self/accounts', responseHeaders: [] },
  setAccountLabel: {
    method: 'PUT',
    path: '/api/v1/self/accounts/{account_id}',
    responseHeaders: [],
  },
  listGrants: { method: 'GET', path: '/api/v1/self/grants', responseHeaders: [] },
  createGrant: { method: 'POST', path: '/api/v1/self/grants', responseHeaders: [] },
  revokeGrant: { method: 'DELETE', path: '/api/v1/self/grants/{grant_id}', responseHeaders: [] },
  getOpenApi: { method: 'GET', path: '/api/v1/openapi.json', responseHeaders: [] },
  getHealth: { method: 'GET', path: '/api/v1/health', responseHeaders: [] },
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
      header?: NonNullable<operations['putSessionLabels']['parameters']['header']>
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
   * Exchange BOOTSTRAP_TOKEN for the first User and an admin Token, once
   *
   * `POST /api/v1/bootstrap`
   */
  bootstrap: {
    input?: {
      body?: NonNullable<operations['bootstrap']['requestBody']>['content']['application/json']
    }
    output: operations['bootstrap']['responses'][200]['content']['application/json']
  }
  /**
   * List every User
   *
   * `GET /api/v1/admin/users`
   */
  listUsers: {
    input?: Record<never, never>
    output: operations['listUsers']['responses'][200]['content']['application/json']
  }
  /**
   * Create a User
   *
   * `POST /api/v1/admin/users`
   */
  createUser: {
    input: {
      body: NonNullable<operations['createUser']['requestBody']>['content']['application/json']
    }
    output: operations['createUser']['responses'][201]['content']['application/json']
  }
  /**
   * Delete a User and everything they own
   *
   * `DELETE /api/v1/admin/users/{user_id}`
   */
  deleteUser: {
    input: { path: NonNullable<operations['deleteUser']['parameters']['path']> }
    output: undefined
  }
  /**
   * List every Team with its members
   *
   * `GET /api/v1/admin/teams`
   */
  listTeams: {
    input?: Record<never, never>
    output: operations['listTeams']['responses'][200]['content']['application/json']
  }
  /**
   * Create a Team
   *
   * `POST /api/v1/admin/teams`
   */
  createTeam: {
    input: {
      body: NonNullable<operations['createTeam']['requestBody']>['content']['application/json']
    }
    output: operations['createTeam']['responses'][201]['content']['application/json']
  }
  /**
   * Delete a Team and everything it owns
   *
   * `DELETE /api/v1/admin/teams/{team_id}`
   */
  deleteTeam: {
    input: { path: NonNullable<operations['deleteTeam']['parameters']['path']> }
    output: undefined
  }
  /**
   * Add a User to a Team, or change their role
   *
   * `PUT /api/v1/admin/teams/{team_id}/members/{user_id}`
   */
  setTeamMember: {
    input: {
      path: NonNullable<operations['setTeamMember']['parameters']['path']>
      body: NonNullable<operations['setTeamMember']['requestBody']>['content']['application/json']
    }
    output: operations['setTeamMember']['responses'][200]['content']['application/json']
  }
  /**
   * Remove a User from a Team
   *
   * `DELETE /api/v1/admin/teams/{team_id}/members/{user_id}`
   */
  removeTeamMember: {
    input: { path: NonNullable<operations['removeTeamMember']['parameters']['path']> }
    output: undefined
  }
  /**
   * List every User's Sources
   *
   * `GET /api/v1/admin/sources`
   */
  listAllSources: {
    input?: Record<never, never>
    output: operations['listAllSources']['responses'][200]['content']['application/json']
  }
  /**
   * Delete any Source and every Signal it sent
   *
   * `DELETE /api/v1/admin/sources/{source_id}`
   */
  deleteAnySource: {
    input: { path: NonNullable<operations['deleteAnySource']['parameters']['path']> }
    output: undefined
  }
  /**
   * Who you are
   *
   * `GET /api/v1/self`
   */
  getSelf: {
    input?: Record<never, never>
    output: operations['getSelf']['responses'][200]['content']['application/json']
  }
  /**
   * Daily exchange rates
   *
   * `GET /api/v1/rates`
   */
  getRates: {
    input?: Record<never, never>
    output: operations['getRates']['responses'][200]['content']['application/json']
  }
  /**
   * List your Sources
   *
   * `GET /api/v1/self/sources`
   */
  listSources: {
    input?: Record<never, never>
    output: operations['listSources']['responses'][200]['content']['application/json']
  }
  /**
   * Create a Source and its ingest Token
   *
   * `POST /api/v1/self/sources`
   */
  createSource: {
    input: {
      body: NonNullable<operations['createSource']['requestBody']>['content']['application/json']
    }
    output: operations['createSource']['responses'][201]['content']['application/json']
  }
  /**
   * Rename one of your Sources
   *
   * `PUT /api/v1/self/sources/{source_id}`
   */
  renameSource: {
    input: {
      path: NonNullable<operations['renameSource']['parameters']['path']>
      body: NonNullable<operations['renameSource']['requestBody']>['content']['application/json']
    }
    output: operations['renameSource']['responses'][200]['content']['application/json']
  }
  /**
   * Delete one of your Sources and every Signal it sent
   *
   * `DELETE /api/v1/self/sources/{source_id}`
   */
  deleteSource: {
    input: { path: NonNullable<operations['deleteSource']['parameters']['path']> }
    output: undefined
  }
  /**
   * List your Tokens
   *
   * `GET /api/v1/self/tokens`
   */
  listTokens: {
    input?: Record<never, never>
    output: operations['listTokens']['responses'][200]['content']['application/json']
  }
  /**
   * Issue yourself a Token
   *
   * `POST /api/v1/self/tokens`
   */
  issueToken: {
    input: {
      body: NonNullable<operations['issueToken']['requestBody']>['content']['application/json']
    }
    output: operations['issueToken']['responses'][201]['content']['application/json']
  }
  /**
   * Revoke one of your Tokens
   *
   * `DELETE /api/v1/self/tokens/{token_id}`
   */
  revokeToken: {
    input: { path: NonNullable<operations['revokeToken']['parameters']['path']> }
    output: undefined
  }
  /**
   * List your Accounts
   *
   * `GET /api/v1/self/accounts`
   */
  listAccounts: {
    input?: Record<never, never>
    output: operations['listAccounts']['responses'][200]['content']['application/json']
  }
  /**
   * Label one of your Accounts
   *
   * `PUT /api/v1/self/accounts/{account_id}`
   */
  setAccountLabel: {
    input: {
      path: NonNullable<operations['setAccountLabel']['parameters']['path']>
      body: NonNullable<operations['setAccountLabel']['requestBody']>['content']['application/json']
    }
    output: operations['setAccountLabel']['responses'][200]['content']['application/json']
  }
  /**
   * List the Grants on your Accounts
   *
   * `GET /api/v1/self/grants`
   */
  listGrants: {
    input?: Record<never, never>
    output: operations['listGrants']['responses'][200]['content']['application/json']
  }
  /**
   * Let a User or a Team read one of your Accounts in one Module
   *
   * `POST /api/v1/self/grants`
   */
  createGrant: {
    input: {
      body: NonNullable<operations['createGrant']['requestBody']>['content']['application/json']
    }
    output: operations['createGrant']['responses'][201]['content']['application/json']
  }
  /**
   * Revoke a Grant on one of your Accounts
   *
   * `DELETE /api/v1/self/grants/{grant_id}`
   */
  revokeGrant: {
    input: { path: NonNullable<operations['revokeGrant']['parameters']['path']> }
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
  /**
   * Whether the Hub is serving
   *
   * `GET /api/v1/health`
   */
  getHealth: {
    input?: Record<never, never>
    output: operations['getHealth']['responses'][200]['content']['application/json']
  }
}
