// The otel Module: OTLP/HTTP JSON ingest and storage of Signals (#32). Platforms list `otel` in
// createHub's modules; the Query API over these tables is #33.

export { otel } from './module'
export { logs, metricsGauge, metricsSum } from './schema'
export { mapLogs, mapMetrics } from './map'
export type { LogRow, Mapped, MetricRow, SumRow } from './map'
export { maxBodyBytes } from './http'
