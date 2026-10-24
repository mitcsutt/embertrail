# The local stack: design

How one person goes from nothing to a running Hub and Dashboard with this machine's Claude Code connected, in one command. This is the design behind `embertrail up` and its siblings; the commands themselves are in [`cli.md`](cli.md#the-local-stack) and the Docker details in [`self-hosting.md`](self-hosting.md).

## The problem

The first local run used to take eight steps: clone, `docker compose up`, read the Hub's log for the one-time management Token, build and link the CLI from source, `embertrail login` with the copied Token, paste the same Token into a `.env` for the Dashboard and recreate it, seed, then `embertrail setup claude-code`. Each step was simple. Together they were a manual protocol between three parts that already had published contracts to do it themselves: a person carried a secret from a log file to a config file twice.

## The target experience

```sh
npx @mitcsutt/embertrail-cli up      # or: npm install -g @mitcsutt/embertrail-cli && embertrail up
```

```
Embertrail is running.

  Dashboard  http://localhost:8080
  Hub        http://localhost:8787  (API reference: http://localhost:8787/api/v1/docs)

Claude Code on this machine sends to the Hub as Source "my-laptop".
Start a new Claude Code session; its first Metrics and Events show on the Dashboard.

  embertrail status    what is running, and where
  embertrail down      stop it (your data stays)
```

No clone, no build, no Token on screen. The rest of the lifecycle is one command each:

| Command              | What it does                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `embertrail up`      | Creates the stack the first time, starts it every time after; idempotent                    |
| `embertrail status`  | Each service's state, the Hub's and Dashboard's health, and whether Claude Code points here |
| `embertrail down`    | Stops the containers; the database volume stays                                             |
| `embertrail upgrade` | Snapshots the database, moves the images to this CLI's version, restarts                    |
| `embertrail reset`   | Deletes the stack, its data and its local state, and unhooks Claude Code (asks for `--yes`) |
| `embertrail logs`    | The containers' logs                                                                        |

## Architecture

### The CLI owns the local lifecycle

The `embertrail` CLI already talks to every Hub through the Query API; it now also owns one Hub's life on this machine. It carries the stack definition inside its package (the repository's [`compose.yaml`](../compose.yaml), bundled as text), so an installed CLI needs no checkout. Everything it creates lives in one private directory, the **local stack directory**: `$EMBERTRAIL_LOCAL_DIR`, else `$XDG_DATA_HOME/embertrail/local`, else `~/.local/share/embertrail/local` (mode 700):

| File           | Holds                                                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `compose.yaml` | The bundled stack, rewritten at every `up` so a newer CLI brings its own                                                |
| `.env`         | What Compose substitutes: ports, image tag, the Postgres password, the bootstrap secret, the Dashboard Token (mode 600) |
| `state.json`   | The Compose project, the URLs, the management Token (mode 600)                                                          |
| `backups/`     | The `pg_dump` snapshot each `upgrade` takes                                                                             |

The Compose project is `embertrail-local`, so a stack started by hand from a clone (project `embertrail`) is never touched.

### First-start identity: the CLI bootstraps its own Hub

The zero-config start prints a management Token to a log, which forces a person to read it. The Hub already has a better contract for this: `POST /api/v1/bootstrap` exchanges a `BOOTSTRAP_TOKEN` for the first User and their management Token ([`identity.md`](identity.md#bootstrap)). On its first `up`, the CLI generates a 256-bit bootstrap secret and a Postgres password, starts the Hub with that secret in `.env`, waits for it to be healthy, and calls bootstrap itself. The management Token goes straight into `state.json` and the CLI's login config; it is never printed. The Hub is unchanged: the CLI is just the first client to use the path the Cloudflare Platform needs anyway, and the zero-config start stays for anyone running `docker compose up` by hand.

If the local state is lost while the database volume survives, bootstrap answers 401 and `up` says so, pointing at `embertrail reset` (or `embertrail login` with a Token the person kept), rather than creating a second admin.

### The Dashboard's credentials: issued by the CLI, held by the proxy

The Dashboard keeps its security model: nginx holds a Token and adds it to `/api` requests, the browser never sees it, cross-origin requests are refused, and both services listen on `127.0.0.1` only. ADR-0005's "the Dashboard trusts whatever sits in front of it (… localhost)" is exactly the local case. What changes is who issues that Token: after bootstrap, `up` issues a Token with only the Scopes the Dashboard uses (`otel:read store:read store:write`), named `dashboard`, writes it to `.env` and starts the `dashboard` profile. No `.env` edit, and the Dashboard never holds the management Token.

**Considered: the Hub serves the Dashboard.** A Hub that serves the built app on its own origin with a local-only trust path would need no Token at all, but it ties the Dashboard to one Platform's server and puts a Token-less path into the Hub's auth, against ADR-0010 (the Dashboard is a separate static app) and ADR-0006 (standalone parts). The CLI-issued Token reaches the same experience with no new trust path, so no ADR is superseded.

### Which Hub, which Token

The local stack adds no credential path of its own; it settles on the rule [#132](https://github.com/mitcsutt/embertrail/issues/132) asks for, so every tool (the CLI, the Dashboard's dev proxy, `seed`) agrees:

1. `EMBERTRAIL_HUB` and `EMBERTRAIL_TOKEN` each override on their own.
2. Otherwise the stored login (`config.json`) supplies what is missing, but a stored Token is sent only to the Hub it was stored for: with only `EMBERTRAIL_HUB` set to another Hub, there is no Token rather than the stored one.
3. `up` is just the tool that writes the stored login for the local Hub. `state.json` holds the management Token so the stack can recover its own login, and no other tool reads it.

One CLI module owns the rule, and Hub URL normalising with it, and is a deliberate export for the Dashboard's scripts. This slice keeps today's `readConfig`; [#132](https://github.com/mitcsutt/embertrail/issues/132) implements the rule.

### The Dashboard's proxy stays narrow

The browser never holds a Token, and the proxy never holds a full-power one: `up` gives it only `otel:read store:read store:write`, so getting through the proxy reads telemetry and edits Boards, but cannot reach the Admin API or the `admin` Scope. Being on `127.0.0.1` does not stop DNS rebinding, which comes from the user's own browser ([#121](https://github.com/mitcsutt/embertrail/issues/121)). So the proxy, or anything that ever replaces it (such as the Hub serving the Dashboard), must also refuse `/api` for any `Host` outside an allowlist (`localhost`, `127.0.0.1`, `[::1]` and the names a reverse proxy adds). #121 adds that allowlist to today's nginx, and `up` needs nothing extra for it.

### Claude Code: the same `setup claude-code`

`up` runs the logic of `setup claude-code` with a Source named after this machine (its hostname, lowercased to the Source name rules; `--source` overrides). It is idempotent the same way: a second `up` keeps the Token already in the settings file.

### Published images, pinned to the CLI's version

The bundled `compose.yaml` names `ghcr.io/mitcsutt/embertrail` and `ghcr.io/mitcsutt/embertrail-dashboard`; the CLI drops their `build:` sections and sets `EMBERTRAIL_VERSION` to its own version, so one CLI release runs one Hub and Dashboard release. `upgrade` is therefore "install a newer CLI, run `embertrail upgrade`". The release workflow ([`.github/workflows/release.yml`](../.github/workflows/release.yml)) builds both images for `linux/amd64` and `linux/arm64`, pushes them with the version tag and `latest`, and publishes the CLI to npm, from one `v*` tag. Until the first release, `embertrail up --build-from <checkout>` builds the images from a clone instead (the CLI remembers it, so `upgrade` rebuilds).

### Status that says where to click

`up` ends with the URLs and the next step; `status` shows each service's Compose state, probes the Hub (`/api/v1/openapi.json`) and the Dashboard (`/config.json`), reads Claude Code's settings to say whether they point at this Hub, and prints the same URLs. Both take `--json`.

## Not in this slice

- **A single binary** (Node SEA or `bun build --compile`) for machines without Node. The npm package and `npx` cover anyone with Claude Code, which itself installs through npm.
- **Demo data from the CLI.** Seeding stays `pnpm --filter @mitcsutt/embertrail-dashboard seed`, a development tool: the demo dataset lives in the Dashboard's tests, and bundling it into the CLI would make the CLI depend on the Dashboard.
- **Other agents.** `up` connects Claude Code because it is the one `setup` target; a second target joins `up` the same way.
- **Remote Hubs.** `up` is for a Hub on this machine. A Hub on a server keeps the [self-hosting](self-hosting.md) flow, where the person owns the reverse proxy and TLS.
