// Test support for the Query API: validates responses against `spec/query-api.yaml` itself
// (not the ops' own schemas), and seeds Sessions from the Claude Code fixtures.

import { readFileSync } from 'node:fs'

import type { TestClient } from '@mitcsutt/embertrail-hub/testing'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { parse } from 'yaml'

import { fixture, postOtlp } from '../../testing'
import type { FixtureName } from '../../testing'

const spec = parse(
  readFileSync(new URL('../../../../../spec/query-api.yaml', import.meta.url), 'utf8'),
) as Record<string, unknown>

const ajv = new Ajv2020({ strict: false, validateSchema: false, allErrors: true })
ajv.addFormat('date-time', (value: string) =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value),
)
ajv.addFormat('uri', (value: string) => /^[a-z][a-z0-9+.-]*:/i.test(value))
ajv.addSchema(spec, 'spec')

const pointer = (path: string) => path.replaceAll('~', '~0').replaceAll('/', '~1')

/**
 * Fails unless `body` matches the spec's schema for this operation's response, so a test
 * proves the served shape is the documented one.
 */
export function assertSpecResponse(path: string, method: string, status: number, body: unknown) {
  const ref = `spec#/paths/${pointer(path)}/${method}/responses/${String(status)}/content/application~1json/schema`
  const validate = ajv.compile({ $ref: ref })
  if (!validate(body)) {
    throw new Error(
      `${method.toUpperCase()} ${path} ${String(status)} does not match the spec: ${ajv.errorsText(validate.errors)}`,
    )
  }
}

/** Fails unless `body` is a Problem with this `type` slug. */
export function assertProblem(body: unknown, slug: string) {
  const validate = ajv.compile({ $ref: 'spec#/components/schemas/Problem' })
  if (!validate(body)) throw new Error(`Not a Problem: ${ajv.errorsText(validate.errors)}`)
  const type = (body as { type: string }).type
  if (type !== `urn:embertrail:problem:${slug}`) throw new Error(`Problem is ${type}, not ${slug}`)
}

const nanoKeys = new Set(['timeUnixNano', 'observedTimeUnixNano', 'startTimeUnixNano'])

/** The fixtures' first Signal, 2026-10-12T09:00:00Z. */
export const fixtureStart = Date.UTC(2026, 9, 12, 9)

export interface SessionSeed {
  /** The fixtures' `session.id` becomes this. */
  sessionId: string
  /** Where the fixtures' times are moved to start. */
  start: Date
  /** Extra resource attributes, such as `embertrail.group.id`. */
  resource?: Record<string, string>
  fixtures?: readonly FixtureName[]
}

const fixtureSession = '0d10f12b-8af0-4d75-86a6-b896d3793411'

/** A fixture moved in time and onto another Session. */
export function shifted(name: FixtureName, seed: SessionSeed): unknown {
  const delta = BigInt(seed.start.getTime() - fixtureStart) * 1_000_000n
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit)
    if (typeof value !== 'object' || value === null) {
      return value === fixtureSession ? seed.sessionId : value
    }
    const entries = Object.entries(value).map(([key, inner]): [string, unknown] => {
      if (nanoKeys.has(key) && typeof inner === 'string') {
        return [key, String(BigInt(inner) + delta)]
      }
      if (key === 'resource' && typeof inner === 'object' && inner !== null) {
        const extra = Object.entries(seed.resource ?? {}).map(([k, v]) => ({
          key: k,
          value: { stringValue: v },
        }))
        const attrs = (inner as { attributes?: unknown[] }).attributes ?? []
        const visited = visit(attrs) as unknown[]
        return [key, { ...inner, attributes: [...visited, ...extra] }]
      }
      return [key, visit(inner)]
    })
    return Object.fromEntries(entries)
  }
  return visit(fixture(name))
}

const allFixtures: readonly FixtureName[] = [
  'logs-startup',
  'logs-turn',
  'metrics-first',
  'metrics-second',
]

/** Posts the fixtures as one Session. `client` must hold a Source-bound `otel:write` Token. */
export async function seedSession(client: TestClient, seed: SessionSeed) {
  for (const name of seed.fixtures ?? allFixtures) {
    const response = await postOtlp(
      client,
      name.startsWith('logs') ? '/v1/logs' : '/v1/metrics',
      shifted(name, seed),
    )
    if (response.status !== 200) {
      throw new Error(
        `Seeding ${name} answered ${String(response.status)}: ${await response.text()}`,
      )
    }
  }
}
