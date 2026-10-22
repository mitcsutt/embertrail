# Development

How to work in this repository: setup, commands, the rules the tooling enforces, and how to add to the workspace. [`AGENTS.md`](../AGENTS.md) is the short version.

## Setup

You need the Node.js version in [`.nvmrc`](../.nvmrc) and pnpm through [Corepack](https://nodejs.org/api/corepack.html); the pnpm version is pinned in the root `package.json`. Docker is needed only for the tests that use Postgres.

```sh
nvm use            # or your version manager's equivalent
corepack enable
pnpm install       # also installs the Git hooks
pnpm db:up         # Postgres 17 on localhost:54317, for the database tests
```

## Commands

Run these from the repo root. Turborepo runs each one across the workspace and caches the results per package.

| Command          | What it does                                                                                                                             |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`      | ESLint in every package and at the root, `prettier --check .`, the secret scan (`secretlint`), and publint and attw on the packed client |
| `pnpm typecheck` | `tsc --noEmit` in every package and at the root                                                                                          |
| `pnpm test`      | Vitest in every package: on Node, and in `workerd` for `apps/worker`                                                                     |
| `pnpm format`    | Prettier over the whole repo                                                                                                             |
| `pnpm db:up`     | Starts the local Postgres from `compose.dev.yaml`; `pnpm db:down` stops it                                                               |
| `pnpm changeset` | Adds a release note for a change that should reach a release                                                                             |

To run one package's task, filter it: `pnpm turbo run test --filter=@mitcsutt/embertrail-server`.

### Tests that need Postgres

Tests that talk to a database read `DATABASE_URL`. Locally, with `pnpm db:up` running:

```sh
DATABASE_URL=postgres://postgres:postgres@localhost:54317/embertrail pnpm test
```

Without `DATABASE_URL` they are skipped locally. In CI (`CI` is set) they always run, against a Postgres 17 service container, so a missing database fails the run rather than skipping it. A new database test wraps itself in `describe.skipIf(skipWithoutPostgres)` and reads `databaseUrl`, both from `apps/server/src/testing/postgres.ts` (ESLint refuses `process.env.DATABASE_URL` in those tests), as `apps/server/src/postgres.test.ts` does; `openTempDb` in `apps/server/src/testing/temp-database.ts` gives each check a fresh database on that server, as `apps/server/src/db.test.ts` does.

The Hub's own tests (`packages/hub`) need no server: they run on PGLite, in-process, with real migrations and row-level security.

### Tests in workerd

`apps/worker` runs its tests inside the Workers runtime through [`@cloudflare/vitest-plugin`](https://developers.cloudflare.com/workers/testing/vitest-integration/) (the successor to `@cloudflare/vitest-pool-workers`), configured in `apps/worker/vitest.config.ts`. Its runtime types come from `wrangler types`, which the `types` task runs before lint, typecheck and test; the generated `worker-configuration.d.ts` is not committed.

## Enforced rules

The rules are mechanical, so they hold for every contributor, human or agent:

- **Git hooks** ([`lefthook.yml`](../lefthook.yml)): before each commit, the secret scan, Prettier and ESLint run on the staged files; each commit message must pass [commitlint](https://commitlint.js.org/) with the [Conventional Commits](https://www.conventionalcommits.org/) config. Never bypass them with `--no-verify`; fix what they report.
- **Commit identity**: the commit-msg hook refuses a commit whose author or committer email isn't a `@users.noreply.github.com` address, since every commit in this public repository is visible. Set yours with `git config user.email '<id>+<username>@users.noreply.github.com'` (GitHub shows it under Settings → Emails).
- **ESLint** ([`eslint.config.js`](../eslint.config.js)): one config for the workspace, built from [`@mitcsutt/kiln-eslint-config`](https://www.npmjs.com/package/@mitcsutt/kiln-eslint-config). It is type-aware, every rule is an error, and unused `eslint-disable` comments are errors too. Beyond that base it enforces two repository rules: the Hub's core and its Modules import no database driver or test support in code that ships (ADR-0004; they reach the database through the Db Port), and the server's database tests take `DATABASE_URL` from the shared helper.
- **Prettier**: [`@mitcsutt/kiln-prettier-config`](https://www.npmjs.com/package/@mitcsutt/kiln-prettier-config), set in the root `package.json`.
- **TypeScript**: every `tsconfig.json` extends a [`@mitcsutt/kiln-tsconfig`](https://www.npmjs.com/package/@mitcsutt/kiln-tsconfig) preset (strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`).
- **Secret scan**: [secretlint](https://github.com/secretlint/secretlint) with its recommended rules, on staged files in the hook and over the whole tree in `pnpm lint`. The repository is public, so nothing secret or deployment-specific belongs in it.
- **CI** ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)): on every pull request and push to `main`, the Lint, Typecheck and Test jobs run, and the **CI passed** job fails unless all of them succeeded. CI passed is the only required check, so a new job must be added to its `needs` list.
- **Dependencies**: shared versions live in the `catalog` in [`pnpm-workspace.yaml`](../pnpm-workspace.yaml) and packages reference them as `catalog:`. Only packages listed under `allowBuilds` may run install scripts. Renovate ([`.github/renovate.json`](../.github/renovate.json)) opens grouped updates weekly.

When a rule gets in the way of good work, change the rule (and this page) in its own pull request rather than working around it.

## Layout

```
apps/
  server/      @mitcsutt/embertrail-server     the Hub on the Docker Platform (private)
  worker/      @mitcsutt/embertrail-worker     the Hub on the Cloudflare Platform (private)
  dashboard/   @mitcsutt/embertrail-dashboard  the Dashboard (private)
packages/
  hub/         @mitcsutt/embertrail-hub        the Hub's core: Ports and the Module contract (private)
  otel/        @mitcsutt/embertrail-otel       the otel Module (private)
  store/       @mitcsutt/embertrail-store      the store Module (private)
  client/      @mitcsutt/embertrail-client     typed Query API client (published later)
  cli/         @mitcsutt/embertrail-cli        the `embertrail` CLI (published later)
spec/          the Query API as OpenAPI 3.1
docs/          these docs, and the ADR index in docs/adr/
.changeset/    pending release notes and the Changesets config
```

Core, Modules and Adapters stay private workspace packages; only the client and the CLI will be published to npm (#17). The Hub, the images and the CLI share one app version through the Changesets `fixed` group; the client versions on its own.

## Adding a package or a Module

1. Create `packages/<name>` (or `apps/<name>` for something deployable), named `@mitcsutt/embertrail-<name>`, with `"private": true` unless it is meant for npm.
2. Copy `package.json` scripts from a sibling: `lint`, `typecheck` and `test`, so Turborepo picks it up. Reference shared dependencies as `catalog:`, adding new ones to the catalog first.
3. Add a `tsconfig.json` extending a `@mitcsutt/kiln-tsconfig` preset, including `src` and any `*.config.ts`.
4. Put tests next to the code as `*.test.ts`.
5. Run `pnpm install`, then `pnpm lint`, `pnpm typecheck` and `pnpm test`.

A Module is a package under `packages/` that plugs into the Hub through the Module contract (#25). [`writing-a-module.md`](writing-a-module.md) covers how to write and test one, and [`ports-and-adapters.md`](ports-and-adapters.md) how the core reaches its database and edge.

## Changing the Query API spec

[`spec/query-api.yaml`](../spec/query-api.yaml) is the source of the client's types and methods. After editing it, regenerate the client and commit both together:

```sh
pnpm --filter @mitcsutt/embertrail-client generate
```

`packages/client/scripts/generate.test.ts` fails when the committed files in `packages/client/src/generated/` differ from a fresh run, and the client's test task hashes the spec, so a spec-only change re-runs it. A new operation also needs a case in `packages/client/src/client.test.ts`: the case table is typed over every operation, so typecheck fails until it has one. Usage is in the [client README](../packages/client/README.md).

### The served document must match the spec

The Hub builds its own OpenAPI document from the Modules' ops and serves it at `/api/v1/openapi.json`. `apps/server/src/spec.test.ts` compares it with the spec through `compareOpenApi` (`@mitcsutt/embertrail-hub/testing`) and fails on drift, so change an op and the spec together. It compares each operation's Module, Scope, security, parameters, request body and success responses by what they accept and return; prose, examples, limits and the spelling of a schema are ignored. A route the spec doesn't describe yet goes in `servedOnly` in that test (today `POST /api/v1/bootstrap`, until #30); the test also fails when such an exception is no longer needed. The Hub serves `/api/v1/docs` and `/llms.txt` from the same document.

## Turborepo

Turborepo's configuration and CLI change between versions. Before changing `turbo.json`, read the docs bundled with the installed version in `node_modules/turbo/docs/` rather than relying on memory.
