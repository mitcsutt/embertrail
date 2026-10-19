import { parseJson, responseError, UnexpectedResponseError } from './errors.ts'
import { operationTable, type Operations } from './generated/operations.ts'

export interface ClientOptions {
  /** The Hub's base URL without a trailing slash, such as `http://localhost:8787`; `''` for the page's own origin. */
  baseUrl: string
  /** A Token (`et_<id>_<secret>`), sent as `Authorization: Bearer`. Omit behind an Edge Identity. */
  token?: string
  /** Headers sent with every request. */
  headers?: Record<string, string>
  /** The `fetch` to call; defaults to the global one. */
  fetch?: typeof globalThis.fetch
}

/** Per-call options, next to an operation's input. */
export interface CallOptions {
  signal?: AbortSignal
}

/** The name of a client operation, such as `queryMetrics`. */
export type OperationId = keyof Operations

/** What an operation takes: its path, query, header and body inputs plus {@link CallOptions}. */
export type OperationInput<K extends OperationId> = NonNullable<Operations[K]['input']> &
  CallOptions

/** What an operation resolves to. */
export type OperationOutput<K extends OperationId> = Operations[K]['output']

/** One method per operation in `spec/query-api.yaml`, named by its `operationId`. */
export type EmbertrailClient = {
  [K in OperationId]: undefined extends Operations[K]['input']
    ? (input?: OperationInput<K>) => Promise<OperationOutput<K>>
    : (input: OperationInput<K>) => Promise<OperationOutput<K>>
}

interface Operation {
  method: string
  path: string
  responseHeaders: readonly string[]
}

interface RequestInput extends CallOptions {
  path?: Record<string, string>
  query?: Record<string, unknown>
  header?: Record<string, string | undefined>
  body?: unknown
}

/**
 * Creates a client for one Hub. Every method throws a `ProblemError` for a
 * problem response and an `UnexpectedResponseError` for any other failure.
 */
export function createClient(options: ClientOptions): EmbertrailClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, '')
  // Called as a plain function: a browser's fetch throws when its `this` is another object.
  const fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init))

  async function send(operation: Operation, input: RequestInput = {}): Promise<unknown> {
    const headers = new Headers(options.headers)
    headers.set('accept', 'application/json, application/problem+json')
    if (options.token !== undefined) headers.set('authorization', `Bearer ${options.token}`)
    for (const [name, value] of Object.entries(input.header ?? {})) {
      if (value !== undefined) headers.set(name, value)
    }
    let body: string | undefined
    if (input.body !== undefined) {
      headers.set('content-type', 'application/json')
      body = JSON.stringify(input.body)
    }

    const url = baseUrl + fillPath(operation.path, input.path) + queryString(input.query)
    const response = await fetchImpl(url, {
      method: operation.method,
      headers,
      body,
      signal: input.signal,
    })
    if (!response.ok) throw await responseError(response)

    const data = await readBody(response)
    if (operation.responseHeaders.length === 0) return data
    return {
      data,
      headers: Object.fromEntries(
        operation.responseHeaders.map((name) => [name, response.headers.get(name)]),
      ),
    }
  }

  return Object.fromEntries(
    Object.entries(operationTable).map(([id, operation]) => [
      id,
      (input?: RequestInput) => send(operation, input),
    ]),
  ) as unknown as EmbertrailClient
}

function fillPath(template: string, values: Record<string, string> = {}): string {
  return template.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    const value = values[name]
    if (value === undefined) throw new TypeError(`Missing path parameter ${name}`)
    return encodeURIComponent(value)
  })
}

function queryString(query: Record<string, unknown> = {}): string {
  const params = new URLSearchParams()
  for (const [name, value] of Object.entries(query)) {
    const values: unknown[] = Array.isArray(value) ? value : [value]
    for (const item of values) {
      // Query parameters are scalars in the spec; undefined and null mean "not set".
      if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
        params.append(name, String(item))
      }
    }
  }
  const encoded = params.toString()
  return encoded === '' ? '' : `?${encoded}`
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text === '') return undefined
  const parsed = parseJson(text)
  if (parsed === undefined) {
    throw new UnexpectedResponseError(
      response.status,
      text,
      `Hub answered ${String(response.status)} with a body that is not JSON`,
    )
  }
  return parsed
}
