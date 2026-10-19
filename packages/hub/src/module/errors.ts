/** Problem `type` slugs: `urn:embertrail:problem:<slug>` (spec/query-api.yaml). */
export type ProblemSlug =
  | 'validation'
  | 'invalid-cursor'
  | 'unauthenticated'
  | 'forbidden'
  | 'identity-conflict'
  | 'not-found'
  | 'conflict'
  | 'precondition-failed'
  | 'payload-too-large'
  | 'invalid'
  | 'query-timeout'
  | 'sql-error'
  | 'too-many-rows'
  | 'internal'

/** One field error on a `validation` problem. */
export interface FieldError {
  /** JSON Pointer into the merged input. */
  pointer: string
  message: string
}

export const problemTitles: Record<ProblemSlug, string> = {
  validation: 'Request failed validation',
  'invalid-cursor': 'Invalid cursor',
  unauthenticated: 'Not authenticated',
  forbidden: 'Forbidden',
  'identity-conflict': 'Token and Edge Identity name different Users',
  'not-found': 'Not found',
  conflict: 'Conflict',
  'precondition-failed': 'Precondition failed',
  'payload-too-large': 'Payload too large',
  invalid: 'Unprocessable request',
  'query-timeout': 'Query timed out',
  'sql-error': 'The database rejected the SQL',
  'too-many-rows': 'Too many rows',
  internal: 'Internal error',
}

/**
 * An error the core maps to `application/problem+json`. Modules throw `notFound`, `conflict`,
 * `invalid`, `tooManyRows`, `invalidCursor`, `preconditionFailed` and `payloadTooLarge`; the rest are raised
 * by the core itself. Anything else a Module throws
 * becomes a 500 naming the Module.
 */
export class HubError extends Error {
  override readonly name = 'HubError'

  constructor(
    readonly status: number,
    readonly slug: ProblemSlug,
    readonly detail?: string,
    readonly errors?: readonly FieldError[],
    /** Postgres SQLSTATE, on `sql-error`. */
    readonly sqlstate?: string,
  ) {
    super(detail ?? problemTitles[slug])
  }

  /** 404. Also what a row hidden by row-level security looks like. */
  static notFound(detail?: string) {
    return new HubError(404, 'not-found', detail)
  }

  /** 409. */
  static conflict(detail?: string) {
    return new HubError(409, 'conflict', detail)
  }

  /** 400: a `cursor` this list didn't issue, or issued for another query. */
  static invalidCursor(detail?: string) {
    return new HubError(400, 'invalid-cursor', detail)
  }

  /** 412: `If-Match` or `If-None-Match` didn't hold. */
  static preconditionFailed(detail?: string) {
    return new HubError(412, 'precondition-failed', detail)
  }

  /** 413: over the op's size limit. */
  static payloadTooLarge(detail?: string) {
    return new HubError(413, 'payload-too-large', detail)
  }

  /** 422: a valid shape that can't be carried out. */
  static invalid(detail: string) {
    return new HubError(422, 'invalid', detail)
  }

  /** 422: the statement ran past its `statement_timeout`. */
  static queryTimeout(detail?: string) {
    return new HubError(422, 'query-timeout', detail)
  }

  /** 422: Postgres refused the caller's SQL, with its SQLSTATE. */
  static sqlError(sqlstate: string, detail: string) {
    return new HubError(422, 'sql-error', detail, undefined, sqlstate)
  }

  /** 422: an aggregate that would return more rows than the Query API's limit. */
  static tooManyRows(detail: string) {
    return new HubError(422, 'too-many-rows', detail)
  }

  static validation(errors: readonly FieldError[]) {
    return new HubError(400, 'validation', errors[0]?.message, errors)
  }

  static unauthenticated(detail?: string) {
    return new HubError(401, 'unauthenticated', detail)
  }

  static forbidden(detail?: string) {
    return new HubError(403, 'forbidden', detail)
  }

  static identityConflict() {
    return new HubError(403, 'identity-conflict')
  }
}

/** Boot refused: a Module or the config breaks a contract rule. The message names both. */
export class HubBootError extends Error {
  override readonly name = 'HubBootError'

  constructor(
    /** `Module "<name>"`, or `Hub config`. */
    readonly subject: string,
    readonly rule: BootRule,
    detail: string,
  ) {
    super(`${subject}: ${rule}: ${detail}`)
  }
}

/** Every rule boot enforces. Each has a test with its message. */
export type BootRule =
  | 'invalid config'
  | 'unknown contract'
  | 'invalid name'
  | 'duplicate name'
  | 'not an owned table'
  | 'table outside schema'
  | 'scope outside prefix'
  | 'invalid path'
  | 'duplicate path'
  | 'no JSON Schema'
  | 'unknown dependency'
  | 'dependsOn cycle'
  | 'retention column'
  | 'foreign key outside core'
  | 'undeclared table'
  | 'missing table'
  | 'migrations behind'
  | 'migrations ahead'
