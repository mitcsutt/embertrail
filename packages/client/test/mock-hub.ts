// A stand-in Hub for the client's tests: an HTTP server on a free port that
// records each request and answers with whatever the test queued.

import { createServer, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface RecordedRequest {
  method: string
  /** Path and query string, as sent. */
  url: string
  headers: IncomingHttpHeaders
  /** The parsed JSON body, or `undefined` when there was none. */
  body: unknown
}

export interface MockResponse {
  status: number
  headers?: Record<string, string>
  /** Sent as JSON unless it is already a string. */
  body?: unknown
}

export interface MockHub {
  baseUrl: string
  requests: RecordedRequest[]
  /** Queues the responses for the next requests, in order. */
  respond: (...responses: MockResponse[]) => void
  close: () => Promise<void>
}

export async function startMockHub(): Promise<MockHub> {
  const requests: RecordedRequest[] = []
  const queue: MockResponse[] = []

  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      requests.push({
        method: request.method ?? '',
        url: request.url ?? '',
        headers: request.headers,
        body: text === '' ? undefined : (JSON.parse(text) as unknown),
      })
      const next = queue.shift() ?? { status: 500, body: 'no response queued' }
      const body =
        next.body === undefined || typeof next.body === 'string'
          ? next.body
          : JSON.stringify(next.body)
      response.writeHead(next.status, {
        ...(typeof next.body === 'object' ? { 'content-type': 'application/json' } : {}),
        ...next.headers,
      })
      response.end(body)
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  return {
    baseUrl: `http://127.0.0.1:${String(port)}`,
    requests,
    respond: (...responses) => queue.push(...responses),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      }),
  }
}
