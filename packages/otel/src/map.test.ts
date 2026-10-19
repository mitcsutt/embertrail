import { describe, expect, it } from 'vitest'

import { claudeCode, fixture } from './testing'
import { mapLogs, mapMetrics } from './map'

const now = new Date('2026-10-19T09:00:00Z')
// Stands in for `ctx.account`: the Account id is the attributes recognition was handed.
const recognise = (attributes: Readonly<Record<string, unknown>>) =>
  Promise.resolve(JSON.stringify(attributes))

function logsWith(resource: Record<string, string>, own: Record<string, string> = {}) {
  const kv = (o: Record<string, string>) =>
    Object.entries(o).map(([key, value]) => ({ key, value: { stringValue: value } }))
  return {
    resourceLogs: [
      {
        resource: { attributes: kv(resource) },
        scopeLogs: [{ logRecords: [{ timeUnixNano: '1792396800000000000', attributes: kv(own) }] }],
      },
    ],
  }
}

describe('mapping Claude Code payloads', () => {
  it('maps the startup batch: unprefixed event names, sequences, one Account', async () => {
    const { rows, rejected } = await mapLogs(fixture(claudeCode.logsStartup), now, recognise)
    expect(rejected).toBe(0)
    expect(rows).toHaveLength(50)
    expect(rows.every((r) => !r.eventName.startsWith('claude_code.'))).toBe(true)
    expect(rows.map((r) => r.eventSequence)).toEqual(rows.map((_, i) => i))
    expect(new Set(rows.map((r) => r.accountId)).size).toBe(1)
    expect(rows.every((r) => r.contentHash === null && r.sessionId !== null)).toBe(true)
    expect(rows[0]?.time).toBe('2026-10-12T09:00:00.003000Z')
  })

  it('maps metrics with a hash per attribute set', async () => {
    const { rows, rejected } = await mapMetrics(fixture(claudeCode.metricsFirst), recognise)
    expect(rejected).toBe(0)
    expect(rows.sums).toHaveLength(7)
    expect(new Set(rows.sums.map((r) => r.attributesHash)).size).toBe(7)
    expect(rows.sums.every((r) => r.isMonotonic && r.startTime !== null)).toBe(true)
  })
})

describe('the Account', () => {
  const account = async (resource: Record<string, string>, own?: Record<string, string>) =>
    JSON.parse(
      (await mapLogs(logsWith(resource, own), now, recognise)).rows[0]?.accountId ?? '',
    ) as unknown

  it('is recognised from the Account attributes, the record’s own winning over the resource', async () => {
    expect(
      await account(
        { 'organization.id': 'org-2', 'user.email': 'a@example.com' },
        { 'organization.id': 'org-1', 'user.account_uuid': 'acct-1' },
      ),
    ).toEqual({
      'organization.id': 'org-1',
      'user.account_uuid': 'acct-1',
      'user.email': 'a@example.com',
    })
  })

  it('passes absent attributes as null, so the core falls back to the Source', async () => {
    expect(await account({})).toEqual({
      'organization.id': null,
      'user.account_uuid': null,
      'user.email': null,
    })
  })
})

describe('Event fields', () => {
  it('falls back to the observed time, then event.timestamp, then now', async () => {
    const at = async (record: Record<string, unknown>) =>
      (await mapLogs({ resourceLogs: [{ scopeLogs: [{ logRecords: [record] }] }] }, now, recognise))
        .rows[0]?.time
    expect(await at({ timeUnixNano: '0', observedTimeUnixNano: '1792396800000000000' })).toBe(
      '2026-10-19T08:00:00.000000Z',
    )
    expect(
      await at({
        attributes: [
          { key: 'event.timestamp', value: { stringValue: '2026-10-18T07:00:00.250Z' } },
        ],
      }),
    ).toBe('2026-10-18T07:00:00.250000Z')
    expect(await at({})).toBe(now.toISOString())
  })

  it('uses eventName when there is no event.name attribute', async () => {
    const { rows } = await mapLogs(
      { resourceLogs: [{ scopeLogs: [{ logRecords: [{ eventName: 'build.done' }] }] }] },
      now,
      recognise,
    )
    expect(rows[0]?.eventName).toBe('build.done')
  })

  it('refuses a record that is not an object', async () => {
    const mapped = await mapLogs(
      { resourceLogs: [{ scopeLogs: [{ logRecords: [1, {}] }] }] },
      now,
      recognise,
    )
    expect(mapped).toMatchObject({ rejected: 1, messages: ['A log record is not a JSON object.'] })
    expect(mapped.rows).toHaveLength(1)
  })

  it('refuses metric points without a time or a finite value', async () => {
    const mapped = await mapMetrics(
      {
        resourceMetrics: [
          {
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: 'm',
                    gauge: {
                      dataPoints: [
                        { asDouble: 1 },
                        { timeUnixNano: '1792396800000000000' },
                        { timeUnixNano: '1792396800000000000', asDouble: 'Infinity' },
                        { timeUnixNano: '1792396800000000000', asInt: '4' },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
      recognise,
    )
    expect(mapped.rejected).toBe(3)
    expect(mapped.rows.gauges.map((g) => g.value)).toEqual([4])
  })
})
