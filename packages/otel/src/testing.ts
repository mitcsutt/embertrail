// Test support for the otel Module and whatever reads its data: the Claude Code fixtures,
// a way to post OTLP to a test Hub, seeded Sessions and the Query API spec validator.
// Imported as `@mitcsutt/embertrail-otel/testing`.

import { readFileSync } from 'node:fs'

import type { TestClient } from '@mitcsutt/embertrail-hub/testing'

/** The synthetic Claude Code payloads in `test/fixtures/claude-code` (see its README). */
export const claudeCode = {
  logsStartup: 'logs-startup',
  logsTurn: 'logs-turn',
  metricsFirst: 'metrics-first',
  metricsSecond: 'metrics-second',
} as const

export type FixtureName = (typeof claudeCode)[keyof typeof claudeCode]

/** A fixture's compact JSON, as Claude Code sends it. */
export function fixtureText(name: FixtureName): string {
  const pretty = readFileSync(
    new URL(`../test/fixtures/claude-code/${name}.json`, import.meta.url),
    'utf8',
  )
  return JSON.stringify(JSON.parse(pretty))
}

/** A fresh, mutable copy of a fixture. */
export function fixture(name: FixtureName): Record<string, unknown> {
  return JSON.parse(fixtureText(name)) as Record<string, unknown>
}

/** The OTLP path a fixture goes to. */
export function pathOf(name: FixtureName) {
  return name.startsWith('logs') ? '/v1/logs' : '/v1/metrics'
}

/** POSTs an OTLP body: an object is sent as JSON, a string or bytes as they are. */
export function postOtlp(
  client: TestClient,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  const payload =
    typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body)
  return client.fetch(path, {
    method: 'POST',
    body: payload,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

export { assertProblem, assertSpecResponse, seedSession } from './query/testing/support'
export type { SessionSeed } from './query/testing/support'
