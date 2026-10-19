// The otel Module: OTLP/HTTP JSON ingest and storage of Signals (#32). Platforms list `otel` in
// createHub's modules. It also serves the Query API over its tables (#33).

export { otel } from './module'
export { logs, metricsGauge, metricsSum, sessionLabels } from './schema'
export { mapLogs, mapMetrics } from './map'
export type { AccountRecogniser, LogRow, Mapped, MetricRow, SumRow } from './map'
export { maxBodyBytes } from './http'
