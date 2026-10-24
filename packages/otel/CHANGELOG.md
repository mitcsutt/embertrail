# @mitcsutt/embertrail-otel

## 0.1.0

### Minor Changes

- 6d91273: The otel Module: Signals stored in the OpenTelemetry data model (`otel_logs`, `otel_metrics_sum`, `otel_metrics_gauge`) and OTLP/HTTP JSON ingest at `/v1/logs`, `/v1/metrics` and `/v1/traces`, with gzip, `partialSuccess` refusals, 413 and 415, idempotent retries, promoted `embertrail.*` Session-link columns, retention on `time`, and an OTLP JSON Lines export.
- f31af9a: The otel Query API: `POST /api/v1/metrics/query` and `/events/query` (filters and `group_by` on any attribute, zone-aware buckets, `too-many-rows` over 10,000 rows, Event lists with cursors, `count_distinct` and percentiles), `GET /api/v1/sessions` and `/sessions/{id}` with cost, tokens, Event counts and Session links, `PUT /api/v1/sessions/{id}/labels` with reserved `embertrail.*` Labels that override attributes, and `GET /api/v1/inventory`. Labels are exported with the OTLP JSON Lines. The Hub adds `HubError.tooManyRows`. In the spec, an Event's `account_id` may be `null`, and the Labels endpoint names the `otel` Module.

### Patch Changes

- 4d6bd26: Admin and self-management API (#30): Admins manage Users, Teams and every Source under `/api/v1/admin` (`admin` Scope); every User manages their own Sources (created with a bound ingest Token), Tokens, Account labels and Grants, and exports their data per Module as streamed JSON Lines, under `/api/v1/self` (`self:manage` Scope). Deletes are hard and remove the record with every row it owns or sent. The operations, and `/api/v1/bootstrap`, are in `spec/query-api.yaml` and the client. The `otel` export now holds only the Owner's own rows, never rows a Grant or Team lets them read. Ingest Tokens hold only Module `:write` Scopes. A Token issued through `self:manage` never outlives the calling Token. `hub.exportOwner` now returns a `ReadableStream` of JSON Lines instead of a string.
- 59dde9d: The Query API spec now matches what the Hub serves: fields the Hub always returns are required in the generated types (such as `meta.unit` and the Event keys). The Hub serves `/api/v1/docs` and `/llms.txt`, lists `Embertrail-Owner` on writes, and documents the `events/query` request body.
- Updated dependencies [4d6bd26]
- Updated dependencies [9d1e17f]
- Updated dependencies [07ee309]
- Updated dependencies [f31af9a]
- Updated dependencies [59dde9d]
- Updated dependencies [ee14ddd]
  - @mitcsutt/embertrail-hub@0.1.0
