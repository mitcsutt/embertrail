// The Module's export: OTLP JSON Lines. Each line is one complete OTLP/JSON export request
// for one stored row, so posting the lines back to /v1/logs and /v1/metrics restores the data
// (and, through de-duplication, stores nothing twice).

import type { Exporter, ScopedDb } from '@mitcsutt/embertrail-hub'
import { asc, gt, sql } from 'drizzle-orm'
import type { AnyColumn } from 'drizzle-orm'

import { keyValues, microsToNanos, wrap } from './otlp'
import type { Attributes } from './otlp'
import { logs, metricsGauge, metricsSum } from './schema'

const page = 1000

/** Microseconds since the epoch as text: exact, unlike a JavaScript Date. */
const micros = (column: AnyColumn) =>
  sql<string | null>`(extract(epoch from ${column}) * 1000000)::bigint::text`

function envelope(row: { resource: Attributes; scopeName: string; scopeVersion: string }) {
  return {
    resource: { attributes: keyValues(row.resource) },
    scope: { name: row.scopeName, version: row.scopeVersion },
  }
}

async function* logLines(db: ScopedDb) {
  let after = 0
  for (;;) {
    const found = await db
      .select({ row: logs, timeUs: micros(logs.time), observedUs: micros(logs.observedTime) })
      .from(logs)
      .where(gt(logs.id, after))
      .orderBy(asc(logs.id))
      .limit(page)
    for (const { row, timeUs, observedUs } of found) {
      const { resource, scope } = envelope(row)
      const record = {
        timeUnixNano: microsToNanos(timeUs ?? '0'),
        ...(observedUs === null ? {} : { observedTimeUnixNano: microsToNanos(observedUs) }),
        ...(row.severityNumber === null ? {} : { severityNumber: row.severityNumber }),
        ...(row.severityText === null ? {} : { severityText: row.severityText }),
        ...(row.eventName === '' ? {} : { eventName: row.eventName }),
        ...(row.body === null ? {} : { body: wrap(row.body) }),
        attributes: keyValues(row.attributes),
        ...(row.traceId === null ? {} : { traceId: row.traceId }),
        ...(row.spanId === null ? {} : { spanId: row.spanId }),
      }
      yield JSON.stringify({
        resourceLogs: [{ resource, scopeLogs: [{ scope, logRecords: [record] }] }],
      })
    }
    const last = found.at(-1)
    if (last === undefined || found.length < page) return
    after = last.row.id
  }
}

async function* metricLines(db: ScopedDb, kind: 'sum' | 'gauge') {
  const table = kind === 'sum' ? metricsSum : metricsGauge
  let after = 0
  for (;;) {
    const found = await db
      .select({ row: table, timeUs: micros(table.time), startUs: micros(table.startTime) })
      .from(table)
      .where(gt(table.id, after))
      .orderBy(asc(table.id))
      .limit(page)
    for (const { row, timeUs, startUs } of found) {
      const { resource, scope } = envelope(row)
      const point = {
        attributes: keyValues(row.attributes),
        ...(startUs === null ? {} : { startTimeUnixNano: microsToNanos(startUs) }),
        timeUnixNano: microsToNanos(timeUs ?? '0'),
        asDouble: row.value,
      }
      const data =
        'isMonotonic' in row
          ? {
              sum: {
                aggregationTemporality: 1,
                isMonotonic: row.isMonotonic,
                dataPoints: [point],
              },
            }
          : { gauge: { dataPoints: [point] } }
      const metric = { name: row.metricName, description: row.description, unit: row.unit, ...data }
      yield JSON.stringify({
        resourceMetrics: [{ resource, scopeMetrics: [{ scope, metrics: [metric] }] }],
      })
    }
    const last = found.at(-1)
    if (last === undefined || found.length < page) return
    after = last.row.id
  }
}

/** OTLP JSON Lines: Events first, then sums, then gauges. */
export const exportOtlp: Exporter = async function* exportOtlp({ db }) {
  yield* logLines(db)
  yield* metricLines(db, 'sum')
  yield* metricLines(db, 'gauge')
}
