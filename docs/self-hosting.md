# Self-hosting on Docker

Run your own Hub on one machine with Docker Compose ([#37](https://github.com/mitcsutt/embertrail/issues/37), ADR-0004). One person, one Hub: no Team, Grant or allowlist step.

## Quick start

You need Docker with Compose. From a clone of this repository:

```sh
docker compose up -d --wait              # the Hub on http://localhost:8787, with Postgres 17
docker compose logs hub                  # the management Token, printed once
```

The first start creates your admin User and prints their management Token between two `====` lines, with the `embertrail login` command ready to copy. Then, on the machine that runs Claude Code, with the [`embertrail` CLI](cli.md) installed:

```sh
embertrail login --hub http://localhost:8787 --token <the printed Token>
embertrail setup claude-code --source laptop
```

`setup claude-code` creates the Source and its ingest Token and writes Claude Code's telemetry settings ([how](cli.md#setup-claude-code)). Start Claude Code afterwards; its Metrics and Events reach the Hub. Read them back with the [Query API](../spec/query-api.yaml) (`/api/v1/docs` on the Hub is the interactive reference), the `embertrail` CLI, or the typed [client](../packages/client/README.md).

Without the CLI installed, the image carries one: `docker compose exec hub embertrail --help` (it reads `EMBERTRAIL_HUB` and `EMBERTRAIL_TOKEN`).

## What starts

| Service    | Image                                 | Role                                                            |
| ---------- | ------------------------------------- | --------------------------------------------------------------- |
| `hub`      | `ghcr.io/mitcsutt/embertrail`         | `embertrail migrate`, then the Hub (`apps/server`) on port 8787 |
| `postgres` | `postgres:17`, volume `postgres-data` | The Hub's database; not published to the host                   |

The Hub listens on `127.0.0.1:8787` only. Put a reverse proxy with TLS in front of it before exposing it, and set `PUBLIC_URL` so the printed login line names that address. The image isn't published to a registry yet, so `docker compose up` builds it from the repository's [`Dockerfile`](../Dockerfile) (add `--build` after pulling new code). The Dashboard (`--profile dashboard`) joins the compose file with #51.

## The zero-config start

With no `BOOTSTRAP_TOKEN`, the Hub's first start calls `hub.directory.createFirstUser()`: one admin User and a management Token holding every Scope, printed to the log once (`apps/server/src/zero-config.ts`). It is the same one-time path as `POST /api/v1/bootstrap` ([`identity.md`](identity.md#bootstrap)), so a restart, or a second Hub on the same database, finds the User and prints nothing. The Token cannot be shown again; if you lose it, create another admin with the database or delete the volume and start over (`docker compose down --volumes`).

Setting `BOOTSTRAP_TOKEN` (32+ characters, such as `openssl rand -hex 32`) turns this off: the Hub creates no User, and you exchange the secret yourself with `embertrail bootstrap --hub … --bootstrap-token …`.

## Configuration

The Hub reads its environment at start (`apps/server/src/config.ts`); an empty variable counts as unset. `compose.yaml` passes the ones in bold; set them in your shell or in a `.env` file next to it.

| Variable                            | Default                   | Meaning                                                                                                                                 |
| ----------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                      | set by `compose.yaml`     | The Postgres connection string. Required                                                                                                |
| `DATABASE_POOL_SIZE`                | `10`                      | Connections in the Hub's pool                                                                                                           |
| `PORT`, `HOST`                      | `8787`, `0.0.0.0`         | Where the server listens inside the container                                                                                           |
| **`BOOTSTRAP_TOKEN`**               | unset                     | Turns the zero-config start off; see above                                                                                              |
| **`RETENTION_DAYS`**                | unset (keep forever)      | Rows older than this are deleted, checked every hour                                                                                    |
| **`PUBLIC_URL`**                    | `http://localhost:<port>` | The address the printed `embertrail login` line uses                                                                                    |
| `ALLOWED_EMAILS`, `ALLOWED_DOMAINS` | empty                     | Comma-separated Edge Identity allowlists ([`identity.md`](identity.md#config)); Docker has no Edge Identity yet, so they have no effect |
| **`EMBERTRAIL_PORT`**               | `8787`                    | The host port Compose publishes (on `127.0.0.1`)                                                                                        |
| **`POSTGRES_PASSWORD`**             | `embertrail`              | The database password; the database is reachable only inside the Compose network                                                        |
| **`EMBERTRAIL_VERSION`**            | `latest`                  | The image tag to run                                                                                                                    |

The Edge Identity Adapter is `noEdgeIdentity()`: Tokens are the only way in.

## Upgrading

Migrations only go forward, and `embertrail migrate` runs at every container start, so upgrading is: snapshot, pull, restart.

```sh
docker compose exec postgres pg_dump -U embertrail embertrail > embertrail-backup.sql
docker compose pull && docker compose up -d --wait   # or: git pull && docker compose up --build -d --wait
```

A database migrated by a newer version stops an older image at start with `migrations ahead`, naming the migration; restore the snapshot to go back. A failed migration leaves the database as it was (one transaction) and the container exits.

## Developing it

- `apps/server/src/`: `config.ts` (env → config), `server.ts` (`startServer`: Hub, listener, zero-config, retention interval), `zero-config.ts`, `main.ts` (the image's entry, bundled to `dist/server.js` by `pnpm --filter @mitcsutt/embertrail-server build`), and `db.ts` (the Docker Db Adapter). `modules.ts` lists the Modules; `embertrail migrate` uses the same list.
- The [`Dockerfile`](../Dockerfile) bundles the server and the CLI with esbuild and installs only `pg`; [`docker-entrypoint.sh`](../docker-entrypoint.sh) migrates, then starts the server.
- `src/server.test.ts` boots the server on Postgres 17 (the zero-config Token, the restart, `BOOTSTRAP_TOKEN`, an unmigrated database); the Docker Db Adapter passes the shared contract suites in `db.test.ts` ([`ports-and-adapters.md`](ports-and-adapters.md#contract-suites)).
- `apps/server/smoke/smoke.sh` is CI's **Docker smoke** job and runs anywhere with Docker, `curl` and `jq`: it builds the image, boots the stack on a random port in its own Compose project, checks the printed Token, ingests the Claude Code fixtures, queries Sessions and Events back, restarts the Hub and checks for no second Token or User, then removes the stack and its volume.
- Publishing the image to `ghcr.io/mitcsutt/embertrail` is not wired yet: the `Dockerfile` builds a self-contained image, so a release workflow only needs to build, tag with the app version and push.
