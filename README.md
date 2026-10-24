# Embertrail

Self-hostable telemetry hub for AI coding agents. Claude Code sends OpenTelemetry straight to it; a Kiln-based [Dashboard](docs/dashboard.md) reads it back. Modular, multi-user, and each part runs on its own.

## Quick start

With Node 24 and Docker running:

```sh
npx @mitcsutt/embertrail-cli up
```

That starts a Hub and the Dashboard on this machine, logs the `embertrail` CLI in, and points this machine's Claude Code at the Hub. It prints where to click (the Dashboard is on http://localhost:8080). `embertrail status`, `down`, `upgrade` and `reset` do the rest ([the local stack](docs/cli.md#the-local-stack)). Until the first release is published, run it from a clone: build the CLI with `pnpm --filter @mitcsutt/embertrail-cli build`, then `node packages/cli/dist/bin.js up --build-from .`.

To run a Hub on a server instead, see [`docs/self-hosting.md`](docs/self-hosting.md).

**Status: building.** The design is locked and lives in this repo's issues, labelled `design`, `adr` and `spec`; build work is tracked in the `epic` issues, starting with Core (#49).

To work on it, see [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`docs/development.md`](docs/development.md). To report a security problem, see [`SECURITY.md`](SECURITY.md).

Licensed under [Apache-2.0](LICENSE).
