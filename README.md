# Embertrail

Self-hostable telemetry hub for AI coding agents. Claude Code sends OpenTelemetry straight to it; a Kiln-based [Dashboard](docs/dashboard.md) reads it back (`docker compose --profile dashboard up`). Modular, multi-user, and each part runs on its own.

**Status: building.** The design is locked and lives in this repo's issues, labelled `design`, `adr` and `spec`; build work is tracked in the `epic` issues, starting with Core (#49). The Hub runs locally on Docker today: see [`docs/self-hosting.md`](docs/self-hosting.md).

To work on it, see [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`docs/development.md`](docs/development.md). To report a security problem, see [`SECURITY.md`](SECURITY.md).

Licensed under [Apache-2.0](LICENSE).
