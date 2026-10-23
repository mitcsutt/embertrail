# The `embertrail` CLI

How a person connects a machine to a Hub and manages it from a terminal ([#31](https://github.com/mitcsutt/embertrail/issues/31), decided in #13, #14 and #17). The package is [`packages/cli`](../packages/cli/), `@mitcsutt/embertrail-cli`, binary `embertrail`. Every command but `migrate` talks to the Hub through [`@mitcsutt/embertrail-client`](../packages/client/README.md), so it is a client of the [Admin and self-management API](admin-api.md) and nothing else.

## The solo path

One person, one Hub, one laptop:

```sh
embertrail bootstrap --hub http://localhost:8787 --bootstrap-token "$BOOTSTRAP_TOKEN"   # or: embertrail login --hub … --token …
embertrail setup claude-code --source laptop
```

`bootstrap` is only for a Hub started with `BOOTSTRAP_TOKEN` (Cloudflare); a Hub that already gave you a management Token needs `login` alone. Neither path involves a Team, Grant or allowlist; keep it that way.

## Commands

`embertrail --help` lists them, and every command (and group, such as `embertrail admin teams --help`) has `--help` with its options. Every command takes `--json` for machine-readable output.

| Command                                                       | What it does                                                                        |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
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

## Login and config

`login` writes `config.json` (`{ "hub", "token" }`) to `$EMBERTRAIL_CONFIG_DIR`, else `$XDG_CONFIG_HOME/embertrail/`, else `~/.config/embertrail/`. The file is mode 600 (its directory 700 when the CLI creates it), written to a sibling file and renamed so a wider mode never survives. `EMBERTRAIL_HUB` and `EMBERTRAIL_TOKEN`, when both are set, replace the stored config (CI, containers). A plain-`http` Hub that is not on this machine gets a warning, since the Token would cross the network unencrypted.

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

`embertrail migrate` builds the Hub with the Modules this repository ships (`hubModules` in `apps/server/src/modules.ts`, today `otel` and `store`) and calls `hub.migrate()`: one transaction, so a failure leaves the database as it was. Repeating it applies nothing. A database holding migrations the code doesn't know (it was migrated by a newer version) fails with `migrations ahead`, naming the migration. The Docker server boots with the same list, so adding a Module there updates both; the Cloudflare entry will import it too.

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
- Tests run the CLI in-process (`run(argv, io)`) against the real Hub on PGLite: `src/testing/harness.ts` injects a `fetch` into `testHub`, a scratch home for the config and Claude settings, and a management Token. The `migrate` command's Postgres test follows [`development.md`](development.md#tests-that-need-postgres).
- A change to what a command sends or reads follows the spec: change `spec/query-api.yaml`, regenerate the client, then the CLI ([`development.md`](development.md#changing-the-query-api-spec)).
- Running from source: `node packages/cli/src/bin.ts <command>` works for every command but `migrate`, because the other workspace packages import without file extensions, which Node cannot resolve. Run `pnpm --filter @mitcsutt/embertrail-cli build` and use `node packages/cli/dist/bin.js <command>`, or call `run` from a test.
- Publishing: the package is self-contained. `pnpm build` ([`scripts/build.ts`](../packages/cli/scripts/build.ts)) bundles the CLI and its private workspace packages (`hub`, `otel`, `store`, `server`, and the `client`) into one `dist/bin.js` with esbuild, so those are `devDependencies`; the only runtime dependency is the Postgres driver, `pg`, which stays external. `pnpm lint:package` (part of `pnpm lint`) proves it: it builds, packs the tarball, installs it into an empty temporary directory outside the repository, and runs the installed `embertrail --help`; with `DATABASE_URL` set it also runs `migrate` twice in a scratch database on that server (the first applies, the second is a no-op) and drops it.
