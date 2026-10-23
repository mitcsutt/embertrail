---
'@mitcsutt/embertrail-hub': minor
'@mitcsutt/embertrail-otel': patch
'@mitcsutt/embertrail-client': minor
---

Admin and self-management API (#30): Admins manage Users, Teams and every Source under `/api/v1/admin` (`admin` Scope); every User manages their own Sources (created with a bound ingest Token), Tokens, Account labels and Grants, and exports their data per Module as streamed JSON Lines, under `/api/v1/self` (`self:manage` Scope). Deletes are hard and remove the record with every row it owns or sent. The operations, and `/api/v1/bootstrap`, are in `spec/query-api.yaml` and the client. The `otel` export now holds only the Owner's own rows, never rows a Grant or Team lets them read. Ingest Tokens hold only Module `:write` Scopes. A Token issued through `self:manage` never outlives the calling Token. `hub.exportOwner` now returns a `ReadableStream` of JSON Lines instead of a string.
