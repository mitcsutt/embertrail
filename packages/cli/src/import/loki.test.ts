import { describe, expect, it } from 'vitest'

import { claudeCode } from '@mitcsutt/embertrail-otel/testing'

import type { Io } from '../io.ts'
import { fakeLoki, lokiEntries } from '../testing/stack.ts'
import type { LokiEntry } from '../testing/stack.ts'

import { endpoint } from './http.ts'
import { convertEntry, logEntries, readEntries } from './loki.ts'

const start = Date.UTC(2025, 5, 1, 9)

function lokiAt(entries: readonly LokiEntry[]) {
  const loki = fakeLoki(entries)
  const io = {
    fetch: (input, init) => Promise.resolve(loki.handler(new Request(input, init))),
  } as Io
  return { loki, at: endpoint(io, 'loki', 'http://loki.test') }
}

async function all(iterable: AsyncIterable<LokiEntry>) {
  const out: LokiEntry[] = []
  for await (const item of iterable) out.push(item)
  return out
}

describe('convertEntry', () => {
  const [entry] = lokiEntries(claudeCode.logsStartup, 's-1', start)

  it('puts the stream labels back into the resource and keeps the line as sent', () => {
    const converted = convertEntry(entry as LokiEntry)
    expect(converted?.resource).toMatchObject({
      'service.name': 'claude-code',
      'host.arch': 'arm64',
    })
    expect(converted?.scope).toEqual({
      name: 'com.anthropic.claude_code.events',
      version: '2.1.296',
    })
    expect(converted?.record).toMatchObject({
      timeUnixNano: entry?.ts,
      body: { stringValue: 'claude_code.managed_settings_resolved' },
    })
    const keys = (converted?.record.attributes as { key: string }[]).map((kv) => kv.key)
    expect(keys).toEqual(expect.arrayContaining(['session.id', 'event.name', 'event.sequence']))
    expect(keys).not.toContain('event_name')
    expect(keys).not.toContain('exporter')
  })

  it('restores event.name from the body when the line lost it', () => {
    const line = JSON.stringify({ body: 'claude_code.api_request', attributes: { x: 1 } })
    const converted = convertEntry({ labels: { session_id: 's-2' }, ts: '1', line })
    expect(converted?.record.attributes).toEqual([
      { key: 'event.name', value: { stringValue: 'api_request' } },
      { key: 'session.id', value: { stringValue: 's-2' } },
      { key: 'x', value: { intValue: '1' } },
    ])
  })

  it('refuses a line that is not the exporter’s JSON', () => {
    expect(convertEntry({ labels: {}, ts: '1', line: 'level=info msg=hi' })).toBeUndefined()
    expect(convertEntry({ labels: {}, ts: '1', line: '[1]' })).toBeUndefined()
  })
})

describe('readEntries', () => {
  const entries = lokiEntries(claudeCode.logsStartup, 's-1', start)

  it('pages forward until the window is read, each entry once', async () => {
    const { loki, at } = lokiAt(entries)
    const read = await all(readEntries(at, '{}', start, start + 3_600_000, 7))
    expect(read).toHaveLength(entries.length)
    expect(new Set(read.map((e) => e.line)).size).toBe(entries.length)
    expect(loki.pages.length).toBeGreaterThan(entries.length / 7)
  })

  it('reads entries that share a timestamp across a page boundary', async () => {
    // Three lines at one time, the page boundary falling after the first two of them.
    const shared = entries.map((e, i) => (i >= 2 && i < 5 ? { ...e, ts: entries[2]?.ts ?? '' } : e))
    const { at } = lokiAt(shared)
    const read = await all(readEntries(at, '{}', start, start + 3_600_000, 4))
    expect(read).toHaveLength(entries.length)
    expect(new Set(read.map((e) => e.line)).size).toBe(entries.length)
  })

  it('fails rather than loop when one timestamp holds more than a page', async () => {
    const same = entries.slice(0, 5).map((e) => ({ ...e, ts: entries[0]?.ts ?? '' }))
    const { at } = lokiAt(same)
    await expect(all(readEntries(at, '{}', start, start + 3_600_000, 2))).rejects.toThrow(
      /raise --loki-limit/,
    )
  })
})

describe('logEntries', () => {
  it('groups records by resource and scope', () => {
    const converted = lokiEntries(claudeCode.logsStartup, 's-1', start).map(
      (e) => convertEntry(e) ?? { record: {}, resource: {}, scope: {} },
    )
    const grouped = logEntries(converted)
    expect(grouped).toHaveLength(1)
    const [first] = grouped as { scopeLogs: { logRecords: unknown[] }[] }[]
    expect(first?.scopeLogs[0]?.logRecords).toHaveLength(converted.length)
  })
})
