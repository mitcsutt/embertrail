import type { problemTypes } from './generated/operations.ts'
import type { components } from './generated/schema.ts'

/** RFC 9457 problem details, as every `/api/v1` error carries them. */
export type Problem = components['schemas']['Problem']

/** A problem `type` URN the spec lists. */
export type ProblemType = (typeof problemTypes)[number]

/** One field error on a `validation` problem. */
export type FieldError = NonNullable<Problem['errors']>[number]

/**
 * A Hub error answered as `application/problem+json`. Branch on `type`, never
 * on `title` or `detail`; quote `request_id` when reporting an `internal` one.
 */
export class ProblemError extends Error {
  override readonly name = 'ProblemError'
  /** Stable URN such as `urn:embertrail:problem:validation`; unknown types pass through as sent. */
  readonly type: ProblemType | (string & Record<never, never>)
  /** The HTTP status. */
  readonly status: number
  readonly title: string
  readonly detail: string | undefined
  readonly request_id: string
  /** Field errors on `validation`; empty otherwise. */
  readonly errors: FieldError[]
  /** The whole problem body, including `sqlstate` and `module` when set. */
  readonly problem: Problem

  constructor(problem: Problem) {
    super(problem.detail ?? problem.title)
    this.type = problem.type
    this.status = problem.status
    this.title = problem.title
    this.detail = problem.detail
    this.request_id = problem.request_id
    this.errors = problem.errors ?? []
    this.problem = problem
  }
}

/** Is `error` a {@link ProblemError}, optionally of one `type`? */
export function isProblemError(error: unknown, type?: ProblemType): error is ProblemError {
  return error instanceof ProblemError && (type === undefined || error.type === type)
}

/**
 * A response the spec does not describe: an error without a problem body (a
 * proxy's 502, say), or a success body that is not JSON.
 */
export class UnexpectedResponseError extends Error {
  override readonly name = 'UnexpectedResponseError'
  readonly status: number
  /** The response body as text. */
  readonly body: string

  constructor(status: number, body: string, message: string) {
    super(message)
    this.status = status
    this.body = body
  }
}

/** Turns a non-2xx response into the error to throw. */
export async function responseError(response: Response): Promise<Error> {
  const body = await response.text()
  if (/json/i.test(response.headers.get('content-type') ?? '')) {
    const parsed = parseJson(body)
    if (isProblem(parsed)) return new ProblemError(parsed)
  }
  return new UnexpectedResponseError(
    response.status,
    body,
    `Hub answered ${String(response.status)} without a problem body`,
  )
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

function isProblem(value: unknown): value is Problem {
  if (typeof value !== 'object' || value === null) return false
  const { type, status } = value as Record<string, unknown>
  return typeof type === 'string' && typeof status === 'number'
}
