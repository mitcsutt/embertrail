# @mitcsutt/embertrail-otel

The otel Module: OTLP/HTTP JSON ingest at `/v1/logs`, `/v1/metrics` and `/v1/traces`, the `otel` schema's tables and their de-duplication keys, retention, an OTLP JSON Lines export, and the Query API over them (`/api/v1/metrics/query`, `/events/query`, `/sessions`, Session Labels and `/inventory`). [`docs/otel.md`](../../docs/otel.md) covers all of it.

## Known limitation

The OTLP JSON Lines export carries no `source_id`. A replay posts every line through one Source-bound Token, so an Owner's Signals from several Sources all land under that one Source. Carrying Source through the export is a follow-up.
