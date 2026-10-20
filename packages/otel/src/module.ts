// The otel Module (#32): stores Signals in the OpenTelemetry data model (ADR-0002) and takes
// OTLP/HTTP JSON straight from agents (ADR-0003). Its Query API is #33.

import { defineModule, op } from '@mitcsutt/embertrail-hub'
import type { Ctx } from '@mitcsutt/embertrail-hub'

import { exportOtlp } from './export'
import { exportResponse, OtlpError, readOtlpJson, statusResponse } from './http'
import { countSpans, mapLogs, mapMetrics } from './map'
import { logs, metricsGauge, metricsSum, migrations } from './schema'
import { storeLogs, storeMetrics } from './store'

/** Turns a refused body into its OTLP status response; anything else is the Hub's 500. */
async function otlp(
  request: Request,
  handle: (body: Record<string, unknown>) => Promise<Response>,
) {
  let body: Record<string, unknown>
  try {
    body = await readOtlpJson(request)
  } catch (error) {
    if (error instanceof OtlpError) return statusResponse(error)
    throw error
  }
  return handle(body)
}

const errorResponses = {
  '400': { description: 'Body is not valid OTLP JSON or gzip. Not retryable.' },
  '413': { description: 'Decoded body over 5 MB. Not retryable; lower the batch size.' },
  '415': { description: 'Anything but `application/json`, or an encoding other than gzip.' },
}

const contentEncoding = {
  name: 'Content-Encoding',
  in: 'header',
  schema: { type: 'string', enum: ['gzip', 'identity'] },
}

function operation(operationId: string, description: string, rejectedKey: string) {
  return {
    operationId,
    description,
    parameters: [contentEncoding],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: { type: 'object' } } },
    },
    responses: {
      '200': {
        description: '`partialSuccess` is present when something was refused.',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                partialSuccess: {
                  type: 'object',
                  properties: {
                    [rejectedKey]: { type: 'string', pattern: '^[0-9]+$' },
                    errorMessage: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
      ...errorResponses,
    },
  }
}

export const otel = defineModule({
  contract: 1,
  name: 'otel',
  tables: { logs, metricsSum, metricsGauge },
  migrations,
  // Kept forever unless the Hub sets RETENTION_DAYS; no rollups.
  retention: { column: 'time' },
  export: exportOtlp,
  ops: {
    logs: op.raw({
      method: 'POST',
      path: '/v1/logs',
      summary: 'Ingest Events (OTLP logs)',
      sourceBound: true,
      openapi: operation(
        'ingestLogs',
        'OTLP/HTTP JSON `ExportLogsServiceRequest`. Each log record becomes one Event; a duplicate of a stored Event is skipped, not rejected. Answered after the batch is stored.',
        'rejectedLogRecords',
      ),
      run: (request, { db, now, account }: Ctx) =>
        otlp(request, async (body) => {
          const mapped = await mapLogs(body, now(), account)
          await storeLogs(db, mapped.rows)
          return exportResponse('rejectedLogRecords', mapped.rejected, mapped.messages)
        }),
    }),
    metrics: op.raw({
      method: 'POST',
      path: '/v1/metrics',
      summary: 'Ingest Metrics (OTLP metrics)',
      sourceBound: true,
      openapi: operation(
        'ingestMetrics',
        'OTLP/HTTP JSON `ExportMetricsServiceRequest`. Delta sums and gauges are stored; cumulative sums, histograms and summaries are refused through `partialSuccess`.',
        'rejectedDataPoints',
      ),
      run: (request, { db, account }: Ctx) =>
        otlp(request, async (body) => {
          const mapped = await mapMetrics(body, account)
          await storeMetrics(db, mapped.rows)
          return exportResponse('rejectedDataPoints', mapped.rejected, mapped.messages)
        }),
    }),
    traces: op.raw({
      method: 'POST',
      path: '/v1/traces',
      summary: 'Refuse traces politely (out of v1)',
      sourceBound: true,
      openapi: operation(
        'ingestTraces',
        'Traces are not stored in v1: every span is refused through `partialSuccess`, so exporters do not retry.',
        'rejectedSpans',
      ),
      run: (request) =>
        otlp(request, (body) => {
          const spans = countSpans(body)
          return Promise.resolve(
            Response.json({
              partialSuccess: {
                rejectedSpans: String(spans),
                errorMessage:
                  'Embertrail v1 does not store traces. Disable the traces exporter for this sender.',
              },
            }),
          )
        }),
    }),
  },
})
