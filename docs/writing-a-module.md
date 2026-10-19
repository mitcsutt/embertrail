# Writing a Module

A Module is a self-contained feature of the Hub with its own storage and routes, such as `otel` or `store`. Every Module plugs in through one contract ([#25](https://github.com/mitcsutt/embertrail/issues/25), ADR-0008), exported by `@mitcsutt/embertrail-hub`. The example to copy is [`packages/hub/src/example/notes.ts`](../packages/hub/src/example/notes.ts), with its tests beside it. [`packages/store`](../packages/store/README.md) (#35) is the first real Module: conditional requests, cursor pagination and a size limit, with no auth, ownership, OpenAPI, export or delete code of its own. [`otel`](otel.md) (#32) is a worked example of `op.raw`, a custom export and Signal tables.

## What the core does for you

A Module declares tables, migrations and ops. It writes no code for any of this:

- **Identity and Scopes.** The caller is resolved from a Token or an Edge Identity, and each op's Scope is checked before it runs.
- **Ownership.** Every row is stamped with its Owner (and Source, for Signals) by column defaults, and row-level security rejects any other value. Reads see only rows the caller may read.
- **Transactions.** Each op runs in one transaction. A throw rolls it back.
- **HTTP.** Input validation, `application/problem+json` errors, and the OpenAPI document at `/api/v1/openapi.json`.
- **Data lifecycle.** Retention sweeps, hard delete by Source or by Owner, and export.

## The shape

```ts
import { defineModule, HubError, moduleSchema, op } from '@mitcsutt/embertrail-hub'
import { eq } from 'drizzle-orm'
import { text, uuid } from 'drizzle-orm/pg-core'
import { z } from 'zod'

const schema = moduleSchema('notes') // Postgres schema, Module name and Scope prefix

export const notesTable = schema.ownedTable('notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
})

export const notes = defineModule({
  contract: 1,
  name: 'notes',
  tables: { notes: notesTable },
  migrations: [
    {
      id: '0000_init',
      sql: 'create table notes (id uuid primary key default gen_random_uuid(), title text not null)',
    },
  ],
  ops: {
    get: op.query({
      method: 'GET',
      path: '/api/v1/notes/{id}',
      summary: 'One note',
      input: z.object({ id: z.uuid() }),
      output: z.object({ id: z.uuid(), title: z.string() }),
      async run({ id }, { db }) {
        const [row] = await db.select().from(notesTable).where(eq(notesTable.id, id))
        if (row === undefined) throw HubError.notFound()
        return { id: row.id, title: row.title }
      },
    }),
  },
})
```

## Tables

- `moduleSchema(name)` names the Module's Postgres schema. The name is lowercase letters, digits and `_`, starts with a letter, and isn't `core`, `public` or `pg_*`. It is also the Scope prefix (`notes:read`).
- `ownedTable` hangs off `moduleSchema(name)` rather than being a top-level export as #25 sketched, so each table is tied to its Module's schema.
- `ownedTable(name, columns)` adds `owner_id`. `ownedTable(name, columns, { signal: true })` adds `source_id` too, for rows a Source sends.
- **Never write `owner_id` or `source_id`.** Their defaults read the caller's session. A Module that writes any other value is refused by the database, and the caller gets a 500 naming the Module.
- **Don't filter by Owner.** Row-level security already hides other Owners' rows, so a row you can't see is simply absent: answer `HubError.notFound()`.
- Every table in the schema must be declared with `ownedTable`, or boot fails (an undeclared table would have no row-level security). Foreign keys may target your own schema or `core.*`, never another Module. (#25 said `core.*` only; a Module's own tables referencing each other is allowed.)

## Migrations

`migrations` is an array of `{ id, sql }`, applied in order, each once, and recorded in `core.migrations`. They are forward-only: never edit one that has shipped; add another.

- Separate statements with `--> statement-breakpoint`, as drizzle-kit does. PGLite runs one statement at a time.
- Unqualified names land in the Module's schema, which the core creates first. If you generate SQL with drizzle-kit, drop its `CREATE SCHEMA` statement.
- Leave out `owner_id`, `source_id`, row-level security and grants. After every migrate the core's policy sync adds the columns (or fixes their default and `NOT NULL` if your SQL declares them, for an index), enables row-level security, writes the policies, indexes `owner_id` and `source_id`, grants the Hub's roles, and sets `security_invoker` on views.
- `dependsOn: ['other']` runs another Module's migrations first. A cycle or an unknown name fails boot.

`embertrail migrate` runs everything in one transaction: core, then Modules in dependency order, then the policy sync and the isolation checks. Any failure leaves the database as it was.

## Ops

| Builder     | Methods           | Default Scope  | Notes                                                                 |
| ----------- | ----------------- | -------------- | --------------------------------------------------------------------- |
| `op.query`  | GET, POST         | `<name>:read`  | Reads.                                                                |
| `op.mutate` | PUT, POST, DELETE | `<name>:write` | Writes.                                                               |
| `op.ingest` | POST              | `<name>:write` | Refused unless the Token is bound to a Source.                        |
| `op.raw`    | any               | `<name>:write` | Gets the `Request`, returns a `Response`; declares its own `openapi`. |

- `input` is a [Standard Schema](https://standardschema.dev) that can also produce JSON Schema (Zod 4 does both). The core merges the path parameters, query string and JSON body, removes any `owner_id` and `source_id`, then validates. Query values arrive as strings, so use `z.coerce` for numbers.
- `output` describes the JSON response, in the OpenAPI document and at runtime: the core parses what `run` returns through it inside the transaction and sends the parsed value, so keys it doesn't declare (such as `ownerId` on a raw row) never leave the Hub. Output that fails its schema rolls the op back and is a 500 naming the Module and op.
- A typed op answers 200 with its output unless it declares `statuses` (such as `[200, 201]` or `[204]`) and returns `reply(output, { status, etag })` or `reply.noContent()`. A status the op doesn't declare is a 500. `etag: true` documents the `ETag` header that `reply` sets.
- `headers` maps input keys to request headers (`{ if_match: 'If-Match' }`). Those keys come only from the header, never the body or query, and OpenAPI lists them as header parameters.
- `scope` narrows the derived Scope within your prefix (`notes:share`) or to `admin`. Claiming another Module's Scope fails boot.
- `run(input, ctx)` gets `ctx.db` (Drizzle on the op's transaction), `ctx.caller` (`userId`, `ownerId`, `sourceId`, `scopes`), `ctx.now()` (the request's time) and `ctx.ownerOf(ownerId)`, which says whether an `owner_id` you read is a User's or a Team's (`{ kind, id }`).
- `op.raw` keeps auth, Scopes and stamping; set `sourceBound: true` for ingest. Use it only when the body isn't JSON, such as OTLP.
- Ops are transport-agnostic: `path` and `method` bind them to HTTP, and the same ops will bind to MCP tools later without changes (`bind` is reserved for that).

### Errors

| Cause                                                     | Response                                       |
| --------------------------------------------------------- | ---------------------------------------------- |
| Input fails its schema                                    | 400 `validation`, with a pointer per field     |
| No Token or Edge Identity, or an invalid one              | 401 `unauthenticated`                          |
| Missing Scope, or ingest without a Source-bound Token     | 403 `forbidden`                                |
| `HubError.notFound()`                                     | 404 `not-found`                                |
| `HubError.conflict()` / `HubError.invalid(detail)`        | 409 `conflict` / 422 `invalid`                 |
| `HubError.invalidCursor()`                                | 400 `invalid-cursor`                           |
| `HubError.preconditionFailed()`                           | 412 `precondition-failed`                      |
| `HubError.payloadTooLarge()`                              | 413 `payload-too-large`                        |
| Anything else thrown, including a refused ownership write | 500 `internal`, with `request_id` and `module` |
| Output that fails its schema                              | 500 `internal`, with the op in `detail`        |

## Retention and export

- `retention: { column: 'created_at' }` deletes rows older than the Hub's `retentionDays` from every table with that column. Omit it to keep rows forever.
- The default export is JSON Lines, one `{"table", "row"}` object per owned row. Override it with `export: async function* (ctx) { … }`, yielding one line at a time (`otel` emits OTLP JSON Lines).

## Testing

```ts
import { assertModuleContract, testHub } from '@mitcsutt/embertrail-hub/testing'

const t = await testHub({ modules: [notes] }) // PGLite, real migrations, real row-level security
const alice = t.as('alice', ['notes:read', 'notes:write']) // a Token; add { sourceId } for ingest
await alice.post('/api/v1/notes', { title: 'First' })
await t.sql(sql`select owner_id from notes.notes`) // outside row-level security, for assertions
await t.close()
```

`t.errors` holds every unexpected error the Hub answered with a 500.

Every Module also runs the contract suite, which takes a `seed` that writes data through the Module's ops:

```ts
await assertModuleContract(notes, {
  async seed(client) {
    await client.post('/api/v1/notes', { title: 'First' })
  },
})
```

It checks that a forged `owner_id` or `source_id` in any request is ignored, that another Owner sees none of the rows (as the app and the read-only role), that export covers every owned row, that delete-by-Source and delete-by-Owner leave nothing behind, and that every op is in the OpenAPI document with its Scope and Module. It does not validate the document against the OpenAPI 3.1 schema. Pass `db` to run it on Postgres instead of PGLite, as [`apps/server/src/db.test.ts`](../apps/server/src/db.test.ts) does.

## What fails boot

`createHub` checks the Modules when it is called; `hub.boot()` (and the first request) checks the database. Each failure names the Module and the rule.

| Rule                       | When                                                                |
| -------------------------- | ------------------------------------------------------------------- |
| `unknown contract`         | `contract` isn't 1                                                  |
| `invalid name`             | The name breaks the schema-name rules above                         |
| `duplicate name`           | Two Modules share a name                                            |
| `not an owned table`       | A table wasn't built with `ownedTable`                              |
| `table outside schema`     | A table lives in another schema                                     |
| `scope outside prefix`     | An op claims a Scope outside `<name>:` other than `admin`           |
| `invalid path`             | A path isn't `/segments` and `{params}`                             |
| `duplicate path`           | Two ops (or an op and the core) share a method and path shape       |
| `no JSON Schema`           | An input or output schema can't produce JSON Schema                 |
| `unknown dependency`       | `dependsOn` names a Module the Hub doesn't load                     |
| `dependsOn cycle`          | `dependsOn` loops                                                   |
| `retention column`         | No table has the `retention` column                                 |
| `foreign key outside core` | A foreign key targets another Module (at migrate and at boot)       |
| `undeclared table`         | A table in the schema isn't declared                                |
| `missing table`            | A declared table doesn't exist after migrations                     |
| `migrations behind`        | A migration isn't applied: run `embertrail migrate`                 |
| `migrations ahead`         | The database has a migration this Hub doesn't know: run a newer Hub |

## Adding it to the Hub

Create the package as [`docs/development.md`](development.md#adding-a-package-or-a-module) describes, depending on `@mitcsutt/embertrail-hub` (`workspace:*`), `drizzle-orm` and `zod`. Each Platform's entry file lists it in `createHub`'s `modules` ([`ports-and-adapters.md`](ports-and-adapters.md#the-entry-file-contract)).
