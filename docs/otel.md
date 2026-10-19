# The otel Module

`packages/otel` stores Signals in the OpenTelemetry data model (ADR-0002) and takes OTLP/HTTP JSON straight from agents, with no Collector (ADR-0003). It is written only against the Module contract ([`writing-a-module.md`](writing-a-module.md)). The Query API over its tables is #33; this page covers storage and ingest (#32).

## Ingest

| Path               | Stores                            | Refuses through `partialSuccess`                                                                        |
| ------------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `POST /v1/logs`    | every log record, as an Event     | records that aren't JSON objects                                                                        |
| `POST /v1/metrics` | delta sums and gauges, as Metrics | cumulative sums, histograms, exponential histograms, summaries, points without a time or a finite value |
| `POST /v1/traces`  | nothing                           | every span: traces are out of v1                                                                        |

- **Who can send:** a Token with `otel:write`, bound to a Source (`op.raw` with `sourceBound`). Owner and Source come from the Token; any sent in attributes or the query string are ignored.
- **Body:** `Content-Type: application/json` (a `charset` is fine), optionally `Content-Encoding: gzip`, at most 5 MiB decoded. Lenient on what Claude Code actually sends: `intValue` as a JSON number or string, `asDouble` for counts, nanosecond timestamps as strings or numbers.
- **Responses:** 200 with `{}`, or `{"partialSuccess": {"rejectedDataPoints": "2", "errorMessage": "…"}}` naming each refused metric (a cumulative sum's message says to set `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=delta`). Errors are `google.rpc.Status` JSON, `{"code": 3, "message": "…"}`: 400 for a body that isn't JSON, an object or gzip; 413 over 5 MiB; 415 for any other media type or encoding. Auth failures come from the core before the Module runs, so they are 401/403 `application/problem+json`.
- **Retries are safe:** the insert is awaited inside the op's transaction, so the 200 is sent only after the batch is stored, and a duplicate is skipped, not counted as refused.

## Tables

Schema `otel`, in the Collector ClickHouse exporter's layout trimmed to what agents send. Names and attributes are kept as sent: `attributes` and `resource` hold them as plain JSON (OTLP `AnyValue`s unwrapped; an int64 beyond 2^53 stays a string), and hot ones are copied into promoted columns. `time` is the point's or record's time in UTC `timestamptz`, so sub-microsecond digits are dropped.

| Columns                                                                     | On          | From                                                                                      |
| --------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------- |
| `owner_id`, `source_id`                                                     | every row   | the Token (the core's defaults)                                                           |
| `time`, `service_name` (`unknown_service` if absent), `session_id`, `model` | every row   | `service.name`, `session.id`, `model`                                                     |
| `account_id`                                                                | every row   | see below                                                                                 |
| `group_id`, `group_kind`, `parent_session_id`, `role`                       | every row   | `embertrail.group.id`, `.group.kind`, `.parent.session_id`, `.role` (ADR-0014)            |
| `event_name`, `event_sequence`, `prompt_id`, `request_id`                   | `otel_logs` | `event.name` (else the record's `eventName`), `event.sequence`, `prompt.id`, `request_id` |
| `metric_name`, `unit`, `value`, `start_time`, `type`                        | metrics     | the metric and its data point                                                             |

A promoted attribute is read from the record's or point's attributes, falling back to the resource's, as the Query API's dimensions are.

**Account:** recognised from the telemetry in #29's order, `organization.id` with `user.account_uuid`, else `user.email` (case-insensitive), and stored as the first 32 hex digits of its SHA-256, so the id never carries an email. A Signal with none of these has no `account_id`. Mapping these ids onto core Accounts is #29's.

### De-duplication keys

| Table                | Unique on                                                                                 |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `otel_logs`          | (`source_id`, `session_id`, `event_sequence`, `event_name`), Claude Code's key            |
| `otel_logs`          | (`source_id`, `content_hash`), set only when `session.id` or `event.sequence` is missing  |
| `otel_metrics_sum`   | (`source_id`, `metric_name`, `attributes_hash`, `start_time`, `time`), NULLs not distinct |
| `otel_metrics_gauge` | the same                                                                                  |

`content_hash` is the SHA-256 of the record's time, event name, attributes, body, severity, resource and scope, as canonical JSON: an exact retry collapses and any difference keeps two records apart. `attributes_hash` covers the point's attributes, the resource and the scope name. Each request writes one `INSERT … SELECT FROM unnest(…) ON CONFLICT DO NOTHING` per table.

## Retention and export

- `retention: { column: 'time' }`: rows are kept forever unless the Hub sets `RETENTION_DAYS`; no rollups.
- The export is **OTLP JSON Lines**: one complete `ExportLogsServiceRequest` or `ExportMetricsServiceRequest` per stored row, Events first. Posting each line back to `/v1/logs` or `/v1/metrics` (by its top-level key) restores the same rows, and into the same Hub stores nothing twice.

## Tests and the benchmark

- `src/module.test.ts` covers ingest over HTTP, `src/export.test.ts` the round trip, `src/map.test.ts` and `src/otlp.test.ts` the mapping. `apps/server/src/otel.test.ts` runs the contract suite, the fixtures twice and the round trip on Postgres 17.
- `@mitcsutt/embertrail-otel/testing` exports the synthetic Claude Code fixtures (`test/fixtures/claude-code/`, see its README) and `postOtlp`, for any package that needs realistic Signals.
- `pnpm --filter @mitcsutt/embertrail-otel bench` prints the parse + map time of the 73 KB startup batch; `src/benchmark.test.ts` fails over 2 ms mean. It asserts CPU time (the median of five rounds' means), not wall-clock, because `pnpm test` runs every package at once and stretches wall-clock time several-fold.
