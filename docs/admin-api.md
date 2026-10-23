# Admin and self-management API

How Users, Teams, Sources, Tokens, Accounts and Grants are managed over HTTP ([#30](https://github.com/mitcsutt/embertrail/issues/30), decided in #13). The `embertrail` CLI ([`cli.md`](cli.md), #31) is its only client in v1. The contract is the `admin` and `self` tags in [`spec/query-api.yaml`](../spec/query-api.yaml); the code is in [`packages/hub/src/admin/`](../packages/hub/src/admin/). The records themselves are described in [`identity.md`](identity.md).

## Two Scopes

| Scope         | Who                        | Routes              | What                                                                                                   |
| ------------- | -------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------ |
| `admin`       | Admins only                | `/api/v1/admin/...` | Users (list, create, delete), Teams (list, create, delete, set or remove a member), every Source       |
| `self:manage` | every User, their own data | `/api/v1/self/...`  | Sources (list, create with an ingest Token, rename, delete), Tokens, Accounts (labels), Grants, export |

`POST /api/v1/bootstrap` (tagged `admin`) creates the first admin once; [`identity.md`](identity.md#bootstrap) covers it. The allowlist (`ALLOWED_EMAILS` / `ALLOWED_DOMAINS`) is configuration, not an API call.

## Rules every op keeps

- **Own records only.** A `self:manage` op reads the caller's records first and answers 404 for anything else, so another User's ids look exactly like ids that don't exist. `admin` ops reach every record.
- **No escalation.** A Token issued through `self:manage` may only hold Scopes its caller holds (403 otherwise); `admin` additionally needs an admin User. No Token outlives the calling Token either, including the one `POST /api/v1/admin/users` issues: its `expires_at` is capped at the calling Token's expiry, and a request with no `expires_at` gets that expiry (a calling Token that never expires, or an Edge Identity, leaves it unset). An ingest Token, which a device keeps in its telemetry config, holds only Module `:write` Scopes, never `admin`, `self:manage`, `sql:read` or a `:read` Scope (422 otherwise); a new Source's ingest Token gets every Module `:write` Scope the caller holds, with no choice of Scopes. A Module `:write` Scope doesn't make an ingest Token a writer everywhere: the core refuses a Source-bound Token on every op that doesn't accept one (403), so a leaked device Token can send telemetry and label its own Session but cannot overwrite or delete `store` documents ([`writing-a-module.md`](writing-a-module.md#ops)).
- **Hard delete only.** Deleting a Source, User or Team removes the record and every row it sent (a Source) or owns (a User or Team) in every Module, in one transaction, through the core's delete-by-Source and delete-by-Owner. The `core` foreign keys cascade to Tokens, Accounts, Grants and memberships. An admin cannot delete their own User, so a Hub always keeps one admin.
- **Export is the caller's own rows.** `GET /api/v1/self/export/{module}` streams JSON Lines (`application/jsonl`) in the Module's native format: `otel` is OTLP JSON Lines that replay through `/v1/logs` and `/v1/metrics`. `hub.exportOwner` returns the stream, which reads in one transaction held until the stream ends, errors or is cancelled, and reads ahead at most one line, so an export is never buffered whole. The default exporter pages each table by `ctid` in that transaction at the default READ COMMITTED level, so a row updated by a concurrent writer mid-export can be emitted twice or missed; an export is a point-in-time copy only for a quiet account.
- **Lists are unpaginated.** These records stay small, so a list answers `{ "items": [...] }`, oldest first, with no cursor.
- **Problems** are the existing types: `validation` (400), `unauthenticated` (401), `forbidden` (403), `not-found` (404), `conflict` (409, a taken email, id or name, or a duplicate Grant) and `invalid` (422, such as a past `expires_at` or an unknown Module). #30 added no new problem type.

## The solo path

One person on their own Hub calls two things: bootstrap (or the Docker zero-config start), then `POST /api/v1/self/sources` with a name, which answers the Source and an ingest Token holding every Module `:write` Scope. No Team, Grant or allowlist step.

## How core ops work

Core ops are not Module ops: they reach the `core` tables, which the app role can't, so they run privileged and check ownership themselves. Like a Module's op, each runs in one transaction (the pipeline's `privileged` one), and `ctx.directory` and `ctx.remove` are on it, so a throw anywhere in the op rolls back all of it: `POST /api/v1/self/sources` creates the Source and its Token together or not at all. Ownership is a Directory read, not a filter in the op: `ownSource`, `ownToken`, `ownAccount` and `ownGrant` answer null for another User's id and for an absent one alike, and lock the row until the op ends. Each is declared with `coreOp()` in [`ops.ts`](../packages/hub/src/admin/ops.ts) (key, method, path, tag, Scope, Zod input and output, statuses, `run(input, ctx)`), and the core:

- routes it and reserves its path, so a Module claiming it fails boot (`duplicate path`);
- resolves the caller, checks the Scope, validates the input and parses the output exactly as for a Module's typed op, but keeps `source_id` in the input, since core ops never write a Module's rows;
- documents it in `/api/v1/openapi.json` as `core.<key>`.

To add one: add it to `ops.ts`, add the same operation to `spec/query-api.yaml` with `operationId: <key>` (the hub's `openapi.test.ts` checks the two agree), regenerate the client and give it a case ([`development.md`](development.md#changing-the-query-api-spec)), and test it on `testHub` like `admin.test.ts` and `self.test.ts`.
