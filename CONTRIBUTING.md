# Contributing to Embertrail

Thanks for helping out. This guide covers the conventions every change follows; [`docs/development.md`](docs/development.md) has setup, commands and the rules the tooling enforces.

## Before you start

- **Read the issue.** The design lives in GitHub issues: `design` for design docs, `adr` for decisions ([index](docs/adr/README.md)), `spec` for buildable specs with acceptance criteria. Build toward the issue's goal; where you depart from it, say so in the pull request.
- **Use the glossary.** [`CONTEXT.md`](CONTEXT.md) defines Embertrail's terms (Hub, Module, Signal, Owner, Source…). Use them exactly in code, commits and issues.
- **Keep it public and generic.** This repository is public. No secrets, no personal details, and nothing specific to one deployment: those belong in that deployment's own private repository.
- **Solo first.** One person on their own Hub is the expected deployment. Multi-user capabilities exist, but the solo path stays free of their steps, config and UI.

## Making a change

1. Branch from `main`.
2. Make the change with tests next to the code (`*.test.ts`).
3. Run `pnpm lint`, `pnpm typecheck` and `pnpm test` from the root.
4. Commit with a [Conventional Commit](https://www.conventionalcommits.org/) message (`feat(otel): …`, `fix(cli): …`, `docs: …`). The Git hooks format, lint and scan your staged files and check the message and your commit email (a GitHub noreply address); don't bypass them.
5. If the change should reach a release, add a changeset with `pnpm changeset`.
6. Open a pull request using the template. **CI passed** must be green before it merges.

One idea per pull request. A significant decision no ADR covers gets a new `adr` issue; departing from an ADR needs a new ADR that supersedes it.

## Reporting security problems

Don't open a public issue. See [`SECURITY.md`](SECURITY.md).

## Licence

By contributing, you agree that your contributions are licensed under the [Apache-2.0 licence](LICENSE).
