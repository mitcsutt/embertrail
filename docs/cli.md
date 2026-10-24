# The `embertrail` CLI

How a person connects a machine to a Hub and manages it from a terminal ([#31](https://github.com/mitcsutt/embertrail/issues/31), decided in #13, #14 and #17). The package is [`packages/cli`](../packages/cli/), `@mitcsutt/embertrail-cli`, binary `embertrail`. Every command but `migrate` talks to the Hub through [`@mitcsutt/embertrail-client`](../packages/client/README.md), so it is a client of the [Admin and self-management API](admin-api.md) and nothing else.

## Installing

`npm install -g @mitcsutt/embertrail-cli` (Node 24), or run it once with `npx @mitcsutt/embertrail-cli <command>`. The package is one bundled file plus `pg`. Until the first release is published, build it from a clone (`pnpm --filter @mitcsutt/embertrail-cli build`) and run `node packages/cli/dist/bin.js`.

## The solo path

One person, one Hub, one laptop:

```sh
embertrail up
```

That is the whole path when the Hub runs on this machine ([the local stack](#the-local-stack)). For a Hub elsewhere:

```sh
embertrail bootstrap --hub https://hub.example --bootstrap-token "$BOOTSTRAP_TOKEN"   # or: embertrail login --hub … --token …
embertrail setup claude-code --source laptop
```

`bootstrap` is only for a Hub started with `BOOTSTRAP_TOKEN` (Cloudflare); a Hub that already gave you a management Token needs `login` alone. Neither path involves a Team, Grant or allowlist; keep it that way.

## Commands

`embertrail --help` lists them, and every command (and group, such as `embertrail admin teams --help`) has `--help` with its options. Every command takes `--json` for machine-readable output.

| Command                                                       | What it does                                                                        |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `up`                                                          | Starts the local stack, creating it the first time, and connects Claude Code        |
| `status`                                                      | The local stack's services, health and URLs                                         |
| `down`                                                        | Stops the local stack; its data stays                                               |
| `upgrade [--version <tag>]`                                   | Snapshots the local database, then runs this CLI's images                           |
| `reset --yes`                                                 | Deletes the local stack, its data and its Tokens, and unhooks Claude Code           |
| `logs [service] [--follow]`                                   | The local stack's logs                                                              |
| `login --hub <url> --token <token>`                           | Checks the Token against the Hub, then stores both                                  |
| `bootstrap --hub <url> --bootstrap-token <t>`                 | Exchanges `BOOTSTRAP_TOKEN` for the first User (an admin) and logs in as them       |
| `setup claude-code --source <name>`                           | Creates the Source and its ingest Token and writes Claude Code's telemetry settings |
| `sources list\|create\|rename\|delete`                        | Your Sources (`self:manage`)                                                        |
| `tokens list\|issue\|revoke`                                  | Your Tokens                                                                         |
| `accounts list\|label`                                        | Your Accounts and their labels                                                      |
| `grants list\|create\|revoke`                                 | Read access to one Account in one Module, for a User or Team                        |
| `export <module> [--out <file>]`                              | Your rows in one Module as JSON Lines, streamed                                     |
| `admin users list\|create\|delete`                            | Users (`admin`)                                                                     |
| `admin teams list\|create\|delete\|set-member\|remove-member` | Teams and their members                                                             |
| `admin sources list\|delete`                                  | Every User's Sources                                                                |
| `migrate`                                                     | Core migrations, then each Module's, then the policy sync, against `DATABASE_URL`   |

Deletes are hard and confirmed by the Hub's own rules (the Admin API doc has them); the CLI does not ask twice.

## The local stack

`up`, `status`, `down`, `upgrade`, `reset` and `logs` run one Hub, its Postgres and the Dashboard on this machine with Docker Compose, all on `127.0.0.1`. Why it works this way is in [`local-stack.md`](local-stack.md).

`embertrail up` on a machine with no stack:

1. checks that Docker with Compose v2 is installed and running, and that ports 8787 and 8080 are free (`--hub-port`, `--dashboard-port` choose others);
2. writes the local stack directory (`$EMBERTRAIL_LOCAL_DIR`, else `$XDG_DATA_HOME/embertrail/local`, else `~/.local/share/embertrail/local`): the `compose.yaml` bundled in the CLI, an `.env` with a generated Postgres password and `BOOTSTRAP_TOKEN`, and `state.json`, all mode 600;
3. starts the Hub, then exchanges the `BOOTSTRAP_TOKEN` for the admin User's management Token, which it keeps in `state.json` and stores as this CLI's login, so it is never printed;
4. issues the Dashboard its own Token (`otel:read store:read store:write`, named `dashboard`), puts it in `.env` and starts the Dashboard, whose proxy holds it;
5. runs [`setup claude-code`](#setup-claude-code) as the Source named after this machine (its hostname, lowercased to the Source name rules; `--source` chooses another and is remembered, `--no-claude-code` skips it);
6. prints the Dashboard's and the Hub's URLs.

A machine that is already set up for another Hub keeps that. A login or target counts as this stack's only when `up` wrote it (the login holds the stack's management Token; the stack connected Claude Code), so one left by a hand-run Hub at the same URL is kept too. When the stored login, or Claude Code's telemetry target, is not this stack's, `up` still starts the stack but leaves both as they are and prints one line saying so. `up --switch` first copies the old `config.json` to `config.json.backup` and the old telemetry `env` entries to `settings.json.embertrail-backup` (refusing if either holds something different; they are written only once the stack is up), then writes the local values. `reset` removes only a login and telemetry settings that point at this stack, and restores a backup `--switch` made. When `EMBERTRAIL_HUB` points elsewhere they override the login's Hub, and `up` says the CLI keeps using that Hub. A machine with nothing configured has no questions to answer.

On a machine with a stack, `up` starts whatever is stopped and keeps every Token, so running it again changes nothing. New `--hub-port` or `--dashboard-port` values move the stack; Claude Code's settings follow, with a new ingest Token. The images are `ghcr.io/mitcsutt/embertrail` and `ghcr.io/mitcsutt/embertrail-dashboard` at the CLI's own version (`latest` for an unreleased `0.0.0` build); `--build-from <checkout>` builds them from a clone instead and is remembered. The Compose project is `embertrail-local` (`--project`, at the first `up` only), so a stack started by hand with `docker compose up` is separate.

| Command   | Detail                                                                                                                                                                                                                                                                                                                                                                                    |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`  | Each service's Compose state, whether the Hub (`/api/v1/openapi.json`) and the Dashboard (`/config.json`) answer, whether Claude Code's settings send to this Hub, the image tag and the directory                                                                                                                                                                                        |
| `down`    | `docker compose down`: the containers go, the `postgres-data` volume and the directory stay                                                                                                                                                                                                                                                                                               |
| `upgrade` | `pg_dump` into `backups/` in the directory, then the new image tag (this CLI's, or `--version`), `pull` (or a rebuild with `--build-from`) and `up`. If `pull` fails the old tag is put back; if `up` fails after it, the new tag stays (the Hub may have migrated) and the error names the snapshot. Migrations only go forward; to go back, restore the snapshot into the older version |
| `reset`   | Without `--yes` it only says what it would delete. With it: `down --volumes`, the directory except `backups/`, the CLI's login when it is to this Hub, and the telemetry block in Claude Code's settings when it sends here (every other setting is kept); a backup made by `up --switch` is restored in their place                                                                      |
| `logs`    | `docker compose logs` for every service, or the one named; `--follow` keeps printing                                                                                                                                                                                                                                                                                                      |

If `state.json` is lost while the volume survives, `up` cannot bootstrap again (the Hub already has its admin) and says so: `embertrail login` with a Token you kept, or `embertrail reset --yes` to start over.

## Login and config

`login` writes `config.json` (`{ "hub", "token" }`) to `$EMBERTRAIL_CONFIG_DIR`, else `$XDG_CONFIG_HOME/embertrail/`, else `~/.config/embertrail/`. The file is mode 600 (its directory 700 when the CLI creates it), written to a sibling file and renamed so a wider mode never survives. `EMBERTRAIL_HUB` and `EMBERTRAIL_TOKEN` each override the stored login on their own (empty means unset); the stored login supplies what they leave out, but a stored Token is used only for the Hub it was stored for, so with only `EMBERTRAIL_HUB` naming another Hub there is no Token rather than the stored one ([`local-stack.md`](local-stack.md#which-hub-which-token) has the reasoning). `resolveTarget` in `packages/cli/src/config.ts` is that one rule and owns Hub URL normalising; the CLI, the Dashboard's dev proxy and `seed` all call it, so `@mitcsutt/embertrail-cli/config` and `/io` are deliberate exports that only the workspace sees (the published package drops them). A plain-`http` Hub that is not on this machine gets a warning, since the Token would cross the network unencrypted.

## `setup claude-code`

Claude Code reads telemetry settings from the `env` of its **user** settings, `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json`, which is how to try this without touching your real one). That `env` overrides shell variables, and project settings cannot set exporters, so the user file is the only reliable place. The command writes:

| Variable                                            | Value                                     |
| --------------------------------------------------- | ----------------------------------------- |
| `CLAUDE_CODE_ENABLE_TELEMETRY`                      | `1`                                       |
| `OTEL_METRICS_EXPORTER`, `OTEL_LOGS_EXPORTER`       | `otlp` (Metrics, and Events as OTLP logs) |
| `OTEL_EXPORTER_OTLP_PROTOCOL`                       | `http/json`                               |
| `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE` | `delta`                                   |
| `OTEL_EXPORTER_OTLP_ENDPOINT`                       | the Hub's URL                             |
| `OTEL_EXPORTER_OTLP_HEADERS`                        | `Authorization=Bearer <ingest Token>`     |

Traces are never enabled: no `OTEL_TRACES_EXPORTER` is written, and a value the user set themselves is left alone. Every other key and `env` entry in the file is kept, and the same block applied twice changes nothing (`applyTelemetry` in `src/claude-code.ts`). The file must be a JSON object; one that is not is reported and left untouched, before any Source is created. The file is always mode 600 (it holds a Token): a wider existing file is tightened, even when its content is already right, and a symlinked file is written through, the mode applying to the file it resolves to. Temporality is pinned to `delta` because the Hub refuses cumulative sums with `partialSuccess`; a re-run overwrites a `cumulative` override.

Running it again is idempotent. For a Source that exists, when the settings already point at this Hub with an ingest Token that is still active (not revoked, not expired) for that Source, the command keeps it: the file is left as it was and nothing is revoked, so other machines sharing that Source and Token keep working. When the settings hold no usable Token for the Source (a new machine, a lost file, a revoked or expired Token, another Hub), it issues a new ingest Token with the logged-in Token's `:write` Scopes and writes it. The Hub never shows a Token twice, and there is no rotate option; revoke the old Token with `tokens revoke` once its replacement is in place.

## `migrate`

`embertrail migrate` migrates the Modules this repository ships (`hubModules` in [`packages/modules`](../packages/modules/src/index.ts), today `otel` and `store`) through `migrateDatabase(db)`, which needs only a Db Port: no Hub config and no Edge Identity. It is one transaction, so a failure leaves the database as it was. Repeating it applies nothing. A database holding migrations the code doesn't know (it was migrated by a newer version) fails with `migrations ahead`, naming the migration. Every Platform boots with the same list, so a new Module is added to `hubModules` and nowhere else; the Docker server imports it and the Cloudflare entry will too. The CLI loads it, the Hub and the Postgres driver only for this command, and depends on a Platform only for its Db Adapter.

The Docker image's entrypoint ([`self-hosting.md`](self-hosting.md)) and the Cloudflare deploy (before `wrangler deploy`) run it. It is the only command that needs a database, and it loads the Hub and the Postgres driver only when it runs.

## Errors and exit codes

A problem from the Hub prints its `title` and status, `detail`, field errors and `request_id`:

```
error: Not found (404)
  No User with that id.
  request_id: 7c0e…
```

A Hub that cannot be reached, a bad config and the like print one `error:` line. Exit code 0 is success, 1 a failed command, 2 a wrong command line.

## Developing it

- A command is a `Command` (`src/command.ts`): its words, options, positionals and `run(ctx, args)`. Add it to `src/commands/` and the list in `src/commands/index.ts`; `--help` is generated from the definition, and `src/cli.test.ts` fails unless every listed command has working `--help`.
- `Io` (`src/io.ts`) is everything outside the arguments: env, home, hostname, `fetch`, the streams, `exec` (to run `docker`) and `portFree`. The local stack's tests (`src/local.test.ts`) swap `exec` for a fake Compose whose `up` boots a real Hub on PGLite with the `BOOTSTRAP_TOKEN` the CLI wrote to `.env`; `apps/server/smoke/up.sh` runs the real thing in CI.
- The local stack's `compose.yaml` is the repository root's, imported with `?raw` (Vitest reads it natively; `scripts/build.ts` has an esbuild plugin for it) and rewritten in `src/local/stack.ts`. A change to `compose.yaml` changes what `embertrail up` runs, so keep its variables (`EMBERTRAIL_PORT`, `DASHBOARD_PORT`, `EMBERTRAIL_VERSION`, `POSTGRES_PASSWORD`, `BOOTSTRAP_TOKEN`, `EMBERTRAIL_DASHBOARD_TOKEN`) and its `dashboard` profile.
- Tests run the CLI in-process (`run(argv, io)`) against the real Hub on PGLite: `src/testing/harness.ts` injects a `fetch` into `testHub`, a scratch home for the config and Claude settings, and a management Token. The `migrate` command's Postgres test follows [`development.md`](development.md#tests-that-need-postgres).
- A change to what a command sends or reads follows the spec: change `spec/query-api.yaml`, regenerate the client, then the CLI ([`development.md`](development.md#changing-the-query-api-spec)).
- Running from source: `node packages/cli/src/bin.ts <command>` works for every command but `migrate`, because the other workspace packages import without file extensions, which Node cannot resolve. Run `pnpm --filter @mitcsutt/embertrail-cli build` and use `node packages/cli/dist/bin.js <command>`, or call `run` from a test.
- Publishing: the package is self-contained. `pnpm build` ([`scripts/build.ts`](../packages/cli/scripts/build.ts)) bundles the CLI and its private workspace packages (`hub`, `otel`, `store`, `server`, and the `client`) into one `dist/bin.js` with esbuild, so those are `devDependencies`; the only runtime dependency is the Postgres driver, `pg`, which stays external. The release workflow ([`.github/workflows/release.yml`](../.github/workflows/release.yml)) publishes it from a `v<version>` tag after the images of the same version. `pnpm lint:package` (part of `pnpm lint`) proves it: it builds, packs the tarball, installs it into an empty temporary directory outside the repository, and runs the installed `embertrail --help`; with `DATABASE_URL` set it also runs `migrate` twice in a scratch database on that server (the first applies, the second is a no-op) and drops it.
