# The read-only SQL endpoint

`POST /api/v1/sql` runs one caller-written `SELECT` under the caller's row-level security ([#34](https://github.com/mitcsutt/embertrail/issues/34), `runSql` in [`spec/query-api.yaml`](../spec/query-api.yaml)). The core serves it, not a Module. The code is in [`packages/hub/src/sql/endpoint.ts`](../packages/hub/src/sql/endpoint.ts).

```sh
curl -s "$HUB/api/v1/sql" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"sql": "select note from store.documents where namespace = $1", "params": ["boards"]}'
# {"columns":[{"name":"note","type":"text"}],"rows":[["…"]],"truncated":false}
```

## The contract

- **Scope:** `sql:read`. `Embertrail-Owner: team:<id>` works as on any other endpoint.
- **Body:** `sql` (1 to 20,000 characters, one statement; a trailing `;` is fine) and optional `params` (up to 100 strings, numbers, booleans or nulls) for `$1`, `$2`… Every param must be referenced.
- **Rows:** at most 10,000; `truncated: true` when there were more.
- **Values:** `timestamptz` as RFC 3339 in UTC (`2026-10-01T07:30:00.123456Z`), `numeric` and `int8` (and arrays of them) as strings, `json`/`jsonb` as JSON, everything else as Postgres's `to_json` gives it. `columns[].type` is the `pg_type` name, with `[]` for arrays (`int8[]`).
- **Errors:** 422 `sql-error` with `sqlstate` when Postgres refuses the statement; 422 `query-timeout` after 10 s.
- **Tables:** every Module's, under its schema (`otel.otel_logs`, `store.documents`). The `core` tables are not readable.

## How it stays read-only

Each layer holds on its own; together they leave a caller no way out of the session:

| Layer                     | What it stops                                                                                                                                                                                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Readonly session          | The Db Port's `readonly` role (SELECT grants only), a 10 s `statement_timeout`, a `READ ONLY` transaction, and the caller's `embertrail.*` settings, so row-level security applies.                                                                                                                          |
| One subquery              | The SQL runs as `select … from (<sql>) as q limit 10001`, so only a query expression parses: `INSERT`, DDL, `SET ROLE`, `RESET ROLE` and `DO` are syntax errors, and a data-modifying `WITH` is refused below the top level. Without this, `SET ROLE` would work: Postgres checks it against the login role. |
| Extended protocol         | The row limit is always a bound parameter, so drivers use the extended protocol, which refuses a second statement even when the text closes the subquery.                                                                                                                                                    |
| Locked built-in functions | `migrate` revokes `set_config` and the session-level advisory lock functions from `PUBLIC`, granting them back to the app role and the migrating role. Otherwise a `SELECT` could rewrite the `embertrail.*` settings, switch the role back to the login role, or hold a lock on a pooled connection.        |
| Fail closed               | Revoking needs the functions' owner, a superuser. Where `migrate` ran as anything less, the revoke is only a warning, and the endpoint answers 500 until `embertrail migrate` runs as a superuser.                                                                                                           |

Views get `security_invoker` from the policy sync, so a view shows only the rows its tables would.

The revoke applies to the whole database: any other non-superuser role in it loses `set_config` too, which `pg_dump` uses. Give such a role `grant execute on function pg_catalog.set_config(text, text, boolean)` explicitly.

## Testing

`sqlEndpointChecks` and `sqlTimeoutChecks` (`@mitcsutt/embertrail-hub/testing`) take a function that opens a fresh database, like `hubInvariantChecks`. The Hub's tests run the endpoint checks on PGLite; [`apps/server/src/db.test.ts`](../apps/server/src/db.test.ts) runs both on Postgres 17. The timeout check is Postgres-only because PGLite never fires `statement_timeout`. A new way out of a read-only session belongs in the `escapes` list in [`packages/hub/src/testing/sql-checks.ts`](../packages/hub/src/testing/sql-checks.ts).

## Known gaps

- No response-size limit beyond 10,000 rows: a few very wide rows can still be large.
