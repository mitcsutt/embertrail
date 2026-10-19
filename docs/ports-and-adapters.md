# Ports and Adapters

The Hub's core imports no database driver and no platform SDK (ADR-0004). It depends on **Ports**, and each Platform supplies **Adapters** that pass one shared contract suite ([#26](https://github.com/mitcsutt/embertrail/issues/26)). v1 has two Ports: Db and Edge Identity. Blob, Vector and Queue stay documented interfaces until a Module needs one (#17).

## The Db Port

```ts
interface DbPort {
  transaction<T>(session: DbSession, fn: (db: ScopedDb) => Promise<T>): Promise<T>
  privileged<T>(fn: (db: ScopedDb) => Promise<T>): Promise<T>
}

interface DbSession {
  role: 'app' | 'readonly' // readonly: SELECT only, the /api/v1/sql role
  userId: string
  ownerId: string
  sourceId?: string
  statementTimeoutMs?: number // readonly defaults to 10 000
}
```

`ScopedDb` is Drizzle on one transaction. `transaction` applies the session before `fn` runs, as the transaction's first statement:

- the role, `embertrail_app` or `embertrail_readonly`, which the core's first migration creates and grants to the connecting role;
- `embertrail.user_id`, `embertrail.owner_id` and `embertrail.source_id`, which the ownership columns' defaults and the row-level security policies read (an absent Source is `''`, read as `NULL`);
- `statement_timeout`, when set.

Each is `SET LOCAL`, so it ends with the transaction and a pooled connection never carries one caller into the next. One connection per call, released when it ends; a throw rolls back and is rethrown unchanged.

`privileged` runs as the connecting role with no session, outside row-level security. Only the core uses it, for migrations, the policy sync, boot checks, retention and deletes. Modules never see it. It replaces #26's `migrate(sources)`: the core runs migrations itself through `privileged`, so an Adapter has no migration logic of its own.

`drizzleDbPort(db)` builds the Port from any Drizzle Postgres database whose `transaction` holds one connection for the whole call, so an Adapter is mostly its connection handling:

| Adapter    | Where                                                                         | Driver                                         |
| ---------- | ----------------------------------------------------------------------------- | ---------------------------------------------- |
| Test       | [`packages/hub/src/testing/pglite.ts`](../packages/hub/src/testing/pglite.ts) | PGLite in-process: a fresh database per call   |
| Docker     | [`apps/server/src/db.ts`](../apps/server/src/db.ts)                           | `pg` pool from `DATABASE_URL`, default size 10 |
| Cloudflare | `apps/worker` (not built yet, #38)                                            | `pg` client per request over Hyperdrive        |

### Row-level security

The policy sync gives every owned table these policies, rewritten after each migrate:

| Command | Who           | Rule                                                                         |
| ------- | ------------- | ---------------------------------------------------------------------------- |
| SELECT  | app, readonly | `owner_id` is the caller's User or Owner                                     |
| INSERT  | app           | `owner_id` is the caller's Owner (and `source_id` their Source, for Signals) |
| UPDATE  | app           | the row is the caller's Owner's, and stays so                                |
| DELETE  | app           | the row is the caller's Owner's                                              |

Core identity (#29) widens SELECT to Teams and Grants by changing the policy sync; Modules don't change.

## The Edge Identity Port

```ts
interface EdgeIdentityPort {
  // The identity the edge asserts, null if none; throws EdgeIdentityError if it is invalid.
  verify(request: Request): Promise<{ email: string } | null>
}
```

| Adapter                                      | Where           | Behaviour                                                                                            |
| -------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------- |
| `noEdgeIdentity()`                           | main entry      | Always null; the default on Docker                                                                   |
| `cloudflareAccess({ teamDomain, audience })` | main entry      | Verifies `Cf-Access-Jwt-Assertion` against the team's JWKS, cached and refreshed on an unknown `kid` |
| `fakeEdgeIdentity(map)`                      | `/testing` only | Maps a header's value to an email; an unknown value is invalid                                       |

Tokens aren't part of this Port: they are core logic over the `core` tables.

### Caller resolution

The core resolves the caller before any op runs: a Token decides the User, and an Edge Identity naming a different User is refused (403 `identity-conflict`). With no Token, a verified email maps to a User, created only when allowlisted (403 otherwise). Neither present: 401.

Users and Tokens are looked up through a `Directory`, which core identity (#29) implements over the `core` tables. Until then `createHub` defaults to a Directory that knows nobody, so every op answers 401; `testHub` supplies its own. Its optional `ownerKind(ownerId)` backs `ctx.ownerOf`; without it every Owner is a User.

## The entry-file contract

Each Platform's entry file builds a typed config and the Ports, then hands them to the core. The core never reads `process.env` or Worker bindings itself.

```ts
const hub = createHub({
  config: { retentionDays: 90 }, // HubConfig, validated at boot
  ports: { db: dockerDb({ url }), edgeIdentity: noEdgeIdentity() },
  modules: [otel, store],
})
// hub.fetch(request), hub.migrate(), hub.boot(), hub.runRetention(),
// hub.deleteBySource(id), hub.deleteByOwner(id), hub.exportOwner(module, ownerId)
```

- **Docker** (`apps/server`, #37): config from env, `migrate()` then `boot()` in the entrypoint before listening, `fetch` through a Node server, `runRetention()` on an interval.
- **Cloudflare** (`apps/worker`, #38): config from bindings, `fetch` from the Worker handler, `runRetention()` from a cron trigger. `embertrail migrate` runs before deploy, never at Worker startup.

`createHub` throws `HubBootError` when a Module breaks the contract; `boot()` checks the database ([what fails boot](writing-a-module.md#what-fails-boot)). `fetch` runs `boot()` once before the first op.

## Contract suites

The checks throw on failure and import no test runner, so the same suite runs under Vitest on Node or in `workerd`:

```ts
import { dbPortChecks } from '@mitcsutt/embertrail-hub/contract'

it.each(dbPortChecks)('$name', async (check) => {
  await expect(check.run(port)).resolves.toBeUndefined()
})
```

- `dbPortChecks` (`/contract`): settings applied before the first statement, the readonly role and its timeout, nothing left behind for the next transaction, rollback with the same error, connections released.
- `edgeIdentityChecks` (`/contract`): valid, absent and invalid assertions, given a fixture of requests.
- `hubInvariantChecks` (`/testing`): the Module contract's invariants (forged ownership refused, cross-Owner reads hidden, rollback, foreign keys outside `core.*` refused, and the Module contract suite), given a function that opens a fresh database. The Hub's tests run them on PGLite; [`apps/server/src/db.test.ts`](../apps/server/src/db.test.ts) runs them on Postgres 17.

A new Adapter passes its Port's suite, and a new Db Adapter also passes `hubInvariantChecks`. Today the suites run against the Test and Docker Db Adapters on Node; the Cloudflare Db Adapter and its `workerd` run in CI come with #38.
