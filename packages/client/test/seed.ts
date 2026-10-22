// A Claude Code Session in the smallest OTLP/HTTP JSON the Hub accepts: one session-count point
// and a few `api_request` Events, so the Query API has something to read back.

import type { TestHub } from './test-hub.ts'

const nanos = (time: Date) => String(BigInt(time.getTime()) * 1_000_000n)
const text = (key: string, value: string) => ({ key, value: { stringValue: value } })
const resource = { attributes: [text('service.name', 'claude-code')] }

export interface SessionSeed {
  sessionId: string
  start: Date
  /** How many `api_request` Events to send, one a minute; defaults to 3. */
  requests?: number
}

/** Posts the Signals as `userId`'s Source `laptop`. */
export async function seedSession(t: TestHub, userId: string, seed: SessionSeed): Promise<void> {
  const ingest = t.as(userId, ['otel:write'], { sourceId: 'laptop' })
  const session = text('session.id', seed.sessionId)
  const point = {
    attributes: [session],
    startTimeUnixNano: nanos(seed.start),
    timeUnixNano: nanos(seed.start),
    asDouble: 1,
  }
  const events = Array.from({ length: seed.requests ?? 3 }, (_, index) => {
    const time = new Date(seed.start.getTime() + index * 60_000)
    return {
      timeUnixNano: nanos(time),
      observedTimeUnixNano: nanos(time),
      body: { stringValue: 'claude_code.api_request' },
      attributes: [
        session,
        text('event.name', 'api_request'),
        text('model', 'claude-sonnet-5-5'),
        { key: 'event.sequence', value: { intValue: index } },
        { key: 'duration_ms', value: { intValue: 100 + index } },
      ],
    }
  })
  const payloads = {
    '/v1/metrics': {
      resourceMetrics: [
        {
          resource,
          scopeMetrics: [
            {
              scope: { name: 'client-test' },
              metrics: [
                {
                  name: 'claude_code.session.count',
                  sum: { aggregationTemporality: 1, isMonotonic: true, dataPoints: [point] },
                },
              ],
            },
          ],
        },
      ],
    },
    '/v1/logs': {
      resourceLogs: [
        { resource, scopeLogs: [{ scope: { name: 'client-test' }, logRecords: events }] },
      ],
    },
  }
  for (const [path, body] of Object.entries(payloads)) {
    const response = await ingest.post(path, body)
    if (response.status !== 200) {
      throw new Error(
        `Seeding ${path} answered ${String(response.status)}: ${await response.text()}`,
      )
    }
  }
}
