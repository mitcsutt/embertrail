# Embertrail

The design is **locked** (#24). Kiln's prerequisites are released (kiln-ui 0.7.0 with the chart tokens, kiln-charts 0.1.0, kiln-dnd 0.1.0), so build work is here: Core (#49, starting with #28), then Cloudflare (#50), Dashboard (#51) and v0.1 (#52). Each spec issue's acceptance criteria are its definition of done.

## Commands

From the root, with Node from `.nvmrc` and pnpm through Corepack: `pnpm lint` (ESLint, Prettier check, secret scan), `pnpm typecheck`, `pnpm test`, `pnpm format`. Database tests need `pnpm db:up` and `DATABASE_URL`; the Hub's own tests run on PGLite. Details in [`docs/development.md`](docs/development.md).

## Enforced rules

- Git hooks scan, format and lint staged files and run commitlint (Conventional Commits). Never use `--no-verify`; fix what they report. Commits must use a `@users.noreply.github.com` email.
- CI runs lint, typecheck and test (Postgres 17, and `workerd` for `apps/worker`) on every pull request; **CI passed** is the one required check.
- Shared dependency versions live in the `pnpm-workspace.yaml` catalog; ESLint, Prettier and TypeScript configs come from Kiln's published `@mitcsutt/kiln-eslint-config`, `kiln-prettier-config` and `kiln-tsconfig`.
- If a rule is wrong, change the rule and its docs in their own pull request; don't work around it.

## Where things live

- `apps/server` (Docker), `apps/worker` (Cloudflare), `apps/dashboard`; `packages/hub` (core), `packages/otel`, `packages/store`, `packages/client`, `packages/cli`; `spec/` (Query API); `docs/`.
- `packages/client` is generated from `spec/query-api.yaml`: after changing the spec, run `pnpm --filter @mitcsutt/embertrail-client generate` ([details](docs/development.md#changing-the-query-api-spec)).
- Adding a package or Module: [`docs/development.md`](docs/development.md#adding-a-package-or-a-module). Writing a Module: [`docs/writing-a-module.md`](docs/writing-a-module.md). The otel Module's ingest, tables, keys and Query API: [`docs/otel.md`](docs/otel.md). Ports, Adapters and `createHub`: [`docs/ports-and-adapters.md`](docs/ports-and-adapters.md). Users, Tokens, Accounts, Grants and bootstrap: [`docs/identity.md`](docs/identity.md). The read-only SQL endpoint and how it stays read-only: [`docs/sql.md`](docs/sql.md). The Admin and self-management API (`/api/v1/admin`, `/api/v1/self`): [`docs/admin-api.md`](docs/admin-api.md).
- Decisions: [`docs/adr/README.md`](docs/adr/README.md) indexes the `adr` issues.

## Public by default

This repo, its issues and its commits are public. Write only generic, reusable content: deployment specifics, personal infrastructure and any one deployment's details belong in that deployment's private repo. A local guard blocks commits and issue writes that match the owner's private pattern list; when it fires, rewrite the content generically.

## Solo first

The expected deployment is one person on their own Hub. Multi-user capabilities exist, and the solo path stays free of their steps, config and UI.

## Sources of truth

- **Design:** GitHub issues. `design` = design docs, `adr` = decisions, `spec` = buildable specs with acceptance criteria. Read the relevant issues before proposing anything; a decision recorded in an `adr` issue stands until a new ADR supersedes it.
- **Language:** `CONTEXT.md` is the glossary. Use its terms exactly in issues, code and commits.
- **Kiln work** (`kiln-charts`, `kiln-dnd`, chart tokens) is tracked in `mitcsutt/kiln`, not here.

## Skills

Matt Pocock's skills are enabled for this repo. Reach for `domain-modeling` when a term or decision appears, `grilling` to stress-test an area, `codebase-design` for module seams, `research` for unverified facts, `prototype` for spikes, and `tdd` once building starts.
