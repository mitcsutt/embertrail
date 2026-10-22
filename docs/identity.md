# Core identity

Who a request acts as, and what it may read: Users, Teams, Sources, Tokens, Accounts and Grants ([#29](https://github.com/mitcsutt/embertrail/issues/29), decided in #13, ADR-0005 and ADR-0007, with the resolution order from #26). The code is in [`packages/hub/src/identity/`](../packages/hub/src/identity/); the tables are in schema `core`.

## The solo path

One person on their own Hub needs one User and nothing else: no Team, no Grant, no allowlist.

1. The first start creates the User: `POST /api/v1/bootstrap` with `BOOTSTRAP_TOKEN` (Cloudflare), or the Docker zero-config start (#37), both through `directory.createFirstUser()`.
2. Connecting a laptop creates a Source and its ingest Token (`embertrail setup claude-code`, through `POST /api/v1/self/sources`; [`admin-api.md`](admin-api.md), #30).
3. Signals arrive, their Accounts are recognised, and the User reads everything they own.

Teams, Grants and `ALLOWED_EMAILS` / `ALLOWED_DOMAINS` only matter once a second person joins. Keep it that way: a new feature must not add a Team or Grant step to this path.

## The records

| Record      | Table            | Rules                                                                                                                                                       |
| ----------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **User**    | `core.users`     | Optional email (lowercased, unique), matched by Edge Identity. `admin` marks an instance admin, who alone may hold the `admin` Scope.                       |
| **Team**    | `core.teams`     | Id is 1–64 letters, digits, `_` or `-` (it appears as `team:<id>`), and never a User's id: both are Owner ids. Members read; editors also act for the Team. |
| **Source**  | `core.sources`   | Owned by one User; its name is unique per User. Every Signal it sends belongs to that User.                                                                 |
| **Token**   | `core.tokens`    | One User + Scopes. Kind `ingest` is bound to exactly one of the User's Sources; `read` and `management` never are (a check constraint enforces both).       |
| **Account** | `core.accounts`  | Recognised from telemetry, never created by hand. Belongs to one User, keyed by its recognition key.                                                        |
| **Grant**   | `core.grants`    | Read access to one Account's rows in one Module, for exactly one User or one Team.                                                                          |
| Bootstrap   | `core.bootstrap` | One row once a first User was created, so bootstrap never works twice, even after every User is deleted.                                                    |

One Hub is one community: there is no organisation above Teams.

## Tokens

- **Format:** `et_<id>_<secret>`, with a 16-character `[a-z0-9]` id and a 40-character base62 secret. `parseToken` rejects anything else before any lookup (401 `Malformed Token`).
- **Storage:** the id is the row's key; only `secret_hash`, the secret's SHA-256 in hex, is stored. Lookup finds the row by id and compares hashes in constant time. `issueToken` returns the Token once; nothing can read it back.
- **Lifetime:** no expiry unless `expiresAt` is set. Rotate by issuing a new Token and revoking the old one; revoking is permanent.
- **Scopes:** each must be one the Hub knows (`hub.scopes`): every `<module>:<verb>` its Modules derive, plus `admin`, `self:manage` and `sql:read`. A Token loses `admin` the moment its User stops being an admin.

## Resolving the caller

The core resolves every op's caller before it runs (`identity/resolve.ts`):

1. A malformed `Authorization` header or Token is 401.
2. A Token decides the User. An unknown, revoked or expired Token, or a wrong secret, is 401.
3. If an Edge Identity is also present and names anyone else, or no User yet, it is 403 `identity-conflict`. Nothing is created.
4. With no Token, a verified Edge Identity email maps to its User. An unknown email becomes a User only when it is in `allowedEmails` or its domain is in `allowedDomains` (exact match, no subdomains); otherwise 403. An invalid assertion is 401.
5. Neither present: 401.
6. `Embertrail-Owner: team:<id>` then makes the caller act for that Team (new rows are stamped with the Team as Owner). Only the Team's editors may send it (403 otherwise), never with a Source-bound Token (403), and any other value is 400.

An Edge-identified User acts as themselves, with every Scope the Hub knows except `admin`, which only an admin gets.

## Row-level security

The policy sync (`db/migrate.ts`) writes these policies on every owned table:

| Command | Rule                                                                                                                                                                  |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SELECT  | `owner_id` is the caller's User, the Owner they act for, or one of their Teams; or, on a table with `account_id`, the row's Account is granted to them in this Module |
| INSERT  | `owner_id` is the caller's Owner, `source_id` their Source (Signal tables), and `account_id`, when set, an Account of that Owner                                      |
| UPDATE  | the row is the caller's Owner's, and stays so (with the INSERT checks)                                                                                                |
| DELETE  | the row is the caller's Owner's                                                                                                                                       |

A Grant never allows writes. The policies call security-definer functions in `core` (`readable_owners()`, `granted_accounts(module)`, `account_owner(id)`); the app and readonly roles have no grants on the `core` tables themselves.

## Accounts

A Module recognises the Account behind telemetry with `ctx.account(attributes)`, which returns its id, creating the Account the first time. The key is the first of:

1. `organization.id` + `user.account_uuid`, when both are present;
2. `user.email`, lowercased;
3. one Unknown Account per Source, for a Source-bound caller (otherwise it throws).

Each User's Accounts are their own: two Sources of one User share an Account, and two Users sending the same identity get one each. An email that arrives later is filled in. The label shown is the User's own, else the email's domain, else `Unknown` (`accountLabel`).

Store the id in an `account_id` column: that is what lets Grants apply to the row. `otel` (#32) does this for every Signal.

An Account always belongs to the caller's User, never a Team, so an op acting for a Team must not store `ctx.account` ids on Team-owned rows: row-level security refuses the write.

## Grants

A Grant lets a User, or every member of a Team, read one Account's rows in one Module and nothing else: not the Account's other Modules, not the owner's other Accounts, and never a write. Grants apply only to tables with an `account_id` column. Revoking one, or removing a Team member, takes effect on the next request.

## Bootstrap

`POST /api/v1/bootstrap` with `Authorization: Bearer <BOOTSTRAP_TOKEN>` and an optional `{ "name", "email" }` creates the first User (an admin) and a management Token holding every Scope, and returns both. It answers 401 when `bootstrapToken` is unset or wrong, and once an admin User exists or bootstrap has been used. Users that Edge Identity signed up before bootstrap ran are not admins, so they don't stop it: bootstrap keeps working until an admin exists, and promotes the User who already has the bootstrap email rather than creating a second one. The Docker zero-config start (#37) calls `hub.directory.createFirstUser()` directly when `BOOTSTRAP_TOKEN` is unset; it is the same one-time path.

## Config

Each Platform's entry file maps env to `HubConfig`; the core validates it at boot.

| Field            | Env               | Notes                                                       |
| ---------------- | ----------------- | ----------------------------------------------------------- |
| `bootstrapToken` | `BOOTSTRAP_TOKEN` | At least 32 characters, such as `openssl rand -hex 32`.     |
| `allowedEmails`  | `ALLOWED_EMAILS`  | Edge Identity emails that become a User on first sight.     |
| `allowedDomains` | `ALLOWED_DOMAINS` | Email domains that do the same; exact match, no subdomains. |

## `hub.directory`

The core's privileged API over these records: `createUser`, `createTeam`, `setTeamMember`, `removeTeamMember`, `createSource`, `renameSource`, `issueToken`, `revokeToken`, `accounts`, `setAccountLabel`, `grant`, `revokeGrant`, `createFirstUser`, and the lists `users`, `teams`, `sources`, `tokens` and `grants`. It enforces the records' own rules (an ingest Token needs a Source, `admin` needs an admin User, a Grant names a loaded Module) and answers with `HubError`s, but it doesn't check who is asking. The [Admin and self-management API](admin-api.md) (#30) wraps it in ops with the `admin` and `self:manage` Scopes, and adds deletion.

## Testing

- `testHub().as(userId, scopes, { sourceId, team })` issues a real Token: it creates the User (and the Source) with those ids if new, so tests can use readable ids such as `'alice'` and `'laptop'`. `team` sends `Embertrail-Owner`.
- `t.user(id, { admin, email })` and `t.team(id, { editors, members })` create Users and Teams; `t.hub.directory` does the rest.
- `testHub({ edgeIdentity: fakeEdgeIdentity(map), config: { allowedDomains } })` sends Edge Identities.
- `src/testing/probe.ts` is a fixture Module with a `whoami` op and `account_id` rows. The Grant and Team checks are part of `hubInvariantChecks`, so they also run on Postgres 17 through `apps/server`.

## Known gaps

- **Module code can still change `embertrail.*` settings.** The app role keeps `set_config`, and row-level security reads those settings; Module code is trusted. `/api/v1/sql` runs caller-written SQL, so its readonly role has `set_config` revoked ([`sql.md`](sql.md#how-it-stays-read-only)).
- `/api/v1/bootstrap` is in the Hub's served OpenAPI document but not yet in `spec/`; it joins the Admin API's spec additions in #30.
