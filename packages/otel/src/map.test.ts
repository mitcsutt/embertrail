import { describe, expect, it } from 'vitest'

import { claudeCode, fixture } from './testing'
import { mapLogs, mapMetrics } from './map'

const now = new Date('2026-10-19T09:00:00Z')

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
    const { rows, rejected } = await mapLogs(fixture(claudeCode.logsStartup), now)
    expect(rejected).toBe(0)
    expect(rows).toHaveLength(50)
    expect(rows.every((r) => !r.eventName.startsWith('claude_code.'))).toBe(true)
    expect(rows.map((r) => r.eventSequence)).toEqual(rows.map((_, i) => i))
    expect(new Set(rows.map((r) => r.accountId)).size).toBe(1)
    expect(rows.every((r) => r.contentHash === null && r.sessionId !== null)).toBe(true)
    expect(rows[0]?.time).toBe('2026-10-12T09:00:00.003000Z')
  })

  it('maps metrics with a hash per attribute set', async () => {
    const { rows, rejected } = await mapMetrics(fixture(claudeCode.metricsFirst))
    expect(rejected).toBe(0)
    expect(rows.sums).toHaveLength(7)
    expect(new Set(rows.sums.map((r) => r.attributesHash)).size).toBe(7)
    expect(rows.sums.every((r) => r.isMonotonic && r.startTime !== null)).toBe(true)
  })
})

describe('the Account', () => {
  const account = async (resource: Record<string, string>, own?: Record<string, string>) =>
    (await mapLogs(logsWith(resource, own), now)).rows[0]?.accountId

  it('is recognised from the organisation and account UUID', async () => {
    const id = await account({ 'organization.id': 'org-1', 'user.account_uuid': 'acct-1' })
    expect(id).toMatch(/^[0-9a-f]{32}$/)
    // Point attributes win over the resource; the email doesn't matter once the ids are known.
    expect(
      await account(
        { 'organization.id': 'org-2' },
        {
          'organization.id': 'org-1',
          'user.account_uuid': 'acct-1',
          'user.email': 'a@example.com',
        },
      ),
    ).toBe(id)
    expect(await account({ 'organization.id': 'org-2', 'user.account_uuid': 'acct-1' })).not.toBe(
      id,
    )
  })

  it('falls back to the email, ignoring case, then to none', async () => {
    const id = await account({ 'user.email': 'Dev@Example.com' })
    expect(id).toBe(await account({ 'user.email': 'dev@example.com' }))
    expect(id).not.toContain('example')
    expect(await account({})).toBeNull()
  })
})

describe('Event fields', () => {
  it('falls back to the observed time, then event.timestamp, then now', async () => {
    const at = async (record: Record<string, unknown>) =>
      (await mapLogs({ resourceLogs: [{ scopeLogs: [{ logRecords: [record] }] }] }, now)).rows[0]
        ?.time
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
    )
    expect(rows[0]?.eventName).toBe('build.done')
  })

  it('refuses a record that is not an object', async () => {
    const mapped = await mapLogs({ resourceLogs: [{ scopeLogs: [{ logRecords: [1, {}] }] }] }, now)
    expect(mapped).toMatchObject({ rejected: 1, messages: ['A log record is not a JSON object.'] })
    expect(mapped.rows).toHaveLength(1)
  })

  it('refuses metric points without a time or a finite value', async () => {
    const mapped = await mapMetrics({
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
    })
    expect(mapped.rejected).toBe(3)
    expect(mapped.rows.gauges.map((g) => g.value)).toEqual([4])
  })
})
