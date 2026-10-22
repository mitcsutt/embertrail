# The otel Module

`packages/otel` stores Signals in the OpenTelemetry data model (ADR-0002) and takes OTLP/HTTP JSON straight from agents, with no Collector (ADR-0003). It is written only against the Module contract ([`writing-a-module.md`](writing-a-module.md)). This page covers storage and ingest (#32) and the Query API over them (#33).

## Ingest

| Path               | Stores                            | Refuses through `partialSuccess`                                                                        |
| ------------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `POST /v1/logs`    | every log record, as an Event     | records that aren't JSON objects                                                                        |
| `POST /v1/metrics` | delta sums and gauges, as Metrics | cumulative sums, histograms, exponential histograms, summaries, points without a time or a finite value |
| `POST /v1/traces`  | nothing                           | every span: traces are out of v1                                                                        |

- **Who can send:** a Token with `otel:write`, bound to a Source (`op.raw` with `sourceBound`). Owner and Source come from the Token; any sent in attributes or the query string are ignored.
- **Body:** `Content-Type: application/json` (a `charset` is fine), optionally `Content-Encoding: gzip`, at most 5 MiB decoded. Lenient on what Claude Code actually sends: `intValue` as a JSON number or string, `asDouble` for counts, nanosecond timestamps as strings or numbers. So that one record can't fail the batch, U+0000 and lone surrogates in strings and keys become U+FFFD, a timestamp that is malformed or after 9999 counts as absent, and a `severityNumber` outside 0–24 is stored as null.
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

**Account:** the core Account `ctx.account` recognises from the Signal's `organization.id`, `user.account_uuid` and `user.email` (a point's own attribute wins over its resource's), in the order [`identity.md`](identity.md#accounts) gives: `organization.id` with `user.account_uuid`, else `user.email` (case-insensitive), else the Source's Unknown Account. So Grants apply to every row.

### De-duplication keys

| Table                | Unique on                                                                                 |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `otel_logs`          | (`source_id`, `session_id`, `event_sequence`, `event_name`), Claude Code's key            |
| `otel_logs`          | (`source_id`, `content_hash`), set only when `session.id` or `event.sequence` is missing  |
| `otel_metrics_sum`   | (`source_id`, `metric_name`, `attributes_hash`, `start_time`, `time`), NULLs not distinct |
| `otel_metrics_gauge` | the same                                                                                  |

`content_hash` is the SHA-256 of the record's time, event name, attributes, body, severity, resource and scope, as canonical JSON: an exact retry collapses and any difference keeps two records apart. A record with no `session.id` and no time at all (no `timeUnixNano`, `observedTimeUnixNano` or `event.timestamp`) is stamped with the request time, so its retries are not collapsed. `attributes_hash` covers the point's attributes, the resource and the scope name. Each request writes one `INSERT … SELECT FROM unnest(…) ON CONFLICT DO NOTHING` per table.

`session_labels` holds each Session's Labels, one row per (`owner_id`, `session_id`). It isn't a Signal table: Labels are written by the caller (any `otel:write` Token, Source-bound or not) and may arrive before the Session's first Signal.

## Query API

The read side of [`spec/query-api.yaml`](../spec/query-api.yaml), in `src/query/`. Each endpoint is a typed op whose `run` calls a plain function (`queryMetrics`, `listEvents`, `aggregateEvents`, `listSessionSummaries`, `getSession`, `putLabels`, `inventory`), so another transport can bind the same functions later.

| Endpoint                                | Scope        | What it does                                                                                    |
| --------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------- |
| `POST /api/v1/metrics/query`            | `otel:read`  | Aggregates one Metric (sums and gauges both), grouped and bucketed                              |
| `POST /api/v1/events/query`             | `otel:read`  | `list`: Events, cursor-paginated; `aggregate`: count, `count_distinct`, sum…, p50/p90/p95/p99   |
| `GET /api/v1/sessions`, `/{session_id}` | `otel:read`  | Session summaries built from Signals and Labels; the detail adds direct children                |
| `PUT /api/v1/sessions/{id}/labels`      | `otel:write` | Replaces the caller's Owner's Labels for a Session; `{}` clears them                            |
| `GET /api/v1/inventory`                 | `otel:read`  | Owners, Sources, Accounts, services, models, Metric and Event names, up to 1,000 attribute keys |

- **Dimensions** (`src/query/dimensions.ts`): a promoted key reads its column; any other key matching the key pattern reads the record's attributes, falling back to the resource's. Equality and `in` compare text forms, so `200` matches a status code sent as a string or a number; `gt`…`lte` compare numbers when the value is a number. `neq`, `not_in` and `not_exists` also match rows that lack the key.
- **Labels override attributes:** the four reserved `embertrail.*` link keys read the Session's Label first, in summaries, filters and `group_by`. Only the reading Owner's own Labels count, so another Owner labelling the same `session.id` changes nothing for them.
- **Buckets:** Postgres's `date_trunc(unit, time, tz)`, so days start at local midnight (23 or 25 hours across DST) and weeks on Monday. Bucket starts come back with the zone's offset at that instant (`Z` for a zero offset); empty buckets are omitted. An unknown zone, or a fixed offset such as `+05:00` (Postgres would read its sign reversed), is 422 `invalid`.
- **Limits:** `group_by` ≤ 3 and Event and Session pages ≤ 1,000 are schema errors (400). An aggregate over 10,000 rows is 422 `too-many-rows`, unless the query sets its own `limit`.
- **Cursors** are tied to the query that issued them (a hash of it), else 400 `invalid-cursor`. Events page on (`time`, `event.sequence`, id); Sessions on their position in the sort.
- **Sessions** are grouped by (`owner_id`, `session.id`). `cost_usd` and `tokens` sum `claude_code.cost.usage` and `claude_code.token.usage` (per `type`). Without `from`/`to`, Sessions known only from Labels are listed too, with null Signal fields.
- **Inventory names:** until core identity (#29) supplies them, an Owner's and a Source's `name` is its id, and an Account's `label` is its email domain or `Unknown`.

Tests: `src/query/query.test.ts` validates every response against the spec document itself (Ajv over `spec/query-api.yaml`), across DST in Berlin and New York, week starts in two zones, each limit at and over its boundary, Labels and a Grant-less second User. `src/query/widgets.test.ts` runs the 20 curated Widget queries (#16) against a month of seeded Sessions on PGLite, each under 500 ms. `src/query/testing/support.ts` has the spec validator and `seedSession`, which moves the Claude Code fixtures onto another Session and time.

## Retention and export

- `retention: { column: 'time' }`: rows are kept forever unless the Hub sets `RETENTION_DAYS`; no rollups. Labels have no `time` column, so they are kept until their Owner is deleted.
- The export is **OTLP JSON Lines**: one complete `ExportLogsServiceRequest` or `ExportMetricsServiceRequest` per stored row, Events first, then one `{"sessionLabels": {"session_id", "labels"}}` line per labelled Session. Posting each OTLP line back to `/v1/logs` or `/v1/metrics` (by its top-level key) and each Labels line to `PUT /api/v1/sessions/{id}/labels` restores the same rows, and into the same Hub stores nothing twice.
- Known limitation (a follow-up): the export carries no `source_id`. A replay goes through one Source-bound Token, so an Owner's Signals from several Sources all land under that one Source, and rows that differed only by Source collapse under the de-duplication keys.

## Tests and the benchmark

- `src/module.test.ts` covers ingest over HTTP, `src/export.test.ts` the round trip, `src/map.test.ts` and `src/otlp.test.ts` the mapping. `apps/server/src/otel.test.ts` runs the contract suite, the fixtures twice and the round trip on Postgres 17.
- `@mitcsutt/embertrail-otel/testing` exports the synthetic Claude Code fixtures (`test/fixtures/claude-code/`, see its README) and `postOtlp`, for any package that needs realistic Signals.
- `pnpm --filter @mitcsutt/embertrail-otel bench` prints the parse + map time of the 73 KB startup batch; `src/benchmark.test.ts` fails over 2 ms mean. It asserts CPU time (the median of five rounds' means), not wall-clock, because `pnpm test` runs every package at once and stretches wall-clock time several-fold.
