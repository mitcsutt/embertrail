---
'@mitcsutt/embertrail-hub': minor
---

Read-only SQL endpoint: `POST /api/v1/sql` (Scope `sql:read`) runs one `SELECT` as the readonly role in a `READ ONLY` transaction with a 10 s timeout, under the caller's row-level security, and returns at most 10,000 rows with `truncated`. Failures are 422 `sql-error` (with `sqlstate`) or `query-timeout`. `migrate` now revokes `set_config` and session-level advisory locks from `PUBLIC` so the readonly role can't leave its session; the endpoint refuses to run where that revoke couldn't apply.
