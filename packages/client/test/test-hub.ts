// The real Hub for the client's tests: `testHub` with the otel and store Modules, reached through
// the client itself. A Token is issued for the User, so the client's `Authorization` header is what
// authenticates; only the transport is swapped, `fetch` going into the Hub instead of the network.

import type { Scope } from '@mitcsutt/embertrail-hub'
import { testHub, type TestHub } from '@mitcsutt/embertrail-hub/testing'
import { otel } from '@mitcsutt/embertrail-otel'
import { store } from '@mitcsutt/embertrail-store'

import { createClient, type ClientOptions, type EmbertrailClient } from '../src/index.ts'
import { operationTable } from '../src/generated/operations.ts'

export type { TestHub }

const baseUrl = 'http://hub.test'

export const hubModules = [otel, store]

/** A client holding a real management Token for `userId` with `scopes`. */
export async function clientFor(
  t: TestHub,
  userId: string,
  scopes: readonly Scope[],
  options: Omit<ClientOptions, 'baseUrl' | 'token' | 'fetch'> = {},
): Promise<EmbertrailClient> {
  await t.user(userId)
  const { token } = await t.hub.directory.issueToken(userId, { kind: 'management', scopes })
  return createClient({
    baseUrl,
    token,
    fetch: (input, init) => t.hub.fetch(new Request(input, init)),
    ...options,
  })
}

/** Names the operations a client has called, so a test can prove it covered all of them. */
export function recordCalls(client: EmbertrailClient): {
  client: EmbertrailClient
  called: Set<string>
} {
  const called = new Set<string>()
  const recorded = Object.fromEntries(
    Object.entries(client as Record<string, (input?: unknown) => Promise<unknown>>).map(
      ([id, call]) => [
        id,
        (input?: unknown) => {
          called.add(id)
          return call(input)
        },
      ],
    ),
  ) as unknown as EmbertrailClient
  return { client: recorded, called }
}

export const operationIds = Object.keys(operationTable)

export { testHub }
