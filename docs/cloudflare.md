# The Cloudflare Platform

How the Hub runs as a Cloudflare Worker (`apps/worker`, epic #50). This page is how it works; the deploy guide (how to run it) comes with #39. The Worker is a skeleton so far: it answers 501 until the Hub is wired in (#38).

## Shape

One Worker serves the Hub at `/api/*` and `/v1/*` and the Dashboard's static assets everywhere else. `run_worker_first` sends only those two prefixes to the Worker code; the edge serves the rest, so asset requests cost no Worker CPU. The Worker exports `fetch` and `scheduled` (the hourly retention run).

## Bindings

`apps/worker/src/env.ts` declares them and `readWorkerConfig` (`apps/worker/src/config.ts`) reads them. An empty binding counts as unset, and a bad one is reported together with every other bad one in a single error.

| Binding              | Kind    | Meaning                                                                                       |
| -------------------- | ------- | --------------------------------------------------------------------------------------------- |
| `HYPERDRIVE`         | binding | The Hyperdrive config for Postgres. Create it with caching disabled.                          |
| `ASSETS`             | binding | The Dashboard's `dist/`, served by Workers Static Assets.                                     |
| `BOOTSTRAP_TOKEN`    | secret  | One-time secret, at least 32 characters, that creates the first User. Unset after bootstrap.  |
| `ACCESS_TEAM_DOMAIN` | var     | `<team>.cloudflareaccess.com`. Set with `ACCESS_AUD`, or neither: one alone fails the config. |
| `ACCESS_AUD`         | var     | The Access application's AUD tag.                                                             |
| `ALLOWED_EMAILS`     | var     | Comma-separated Edge Identity emails that become Users on first sight. Empty for a solo Hub.  |
| `ALLOWED_DOMAINS`    | var     | Comma-separated email domains that do the same. Empty for a solo Hub.                         |
| `RETENTION_DAYS`     | var     | Days to keep rows. Unset keeps them forever.                                                  |

With neither Access binding set the Hub takes Tokens only. With both set it also trusts `Cf-Access-Jwt-Assertion`, verified against the team's keys.

## The committed `wrangler.jsonc`

It is for development and tests and holds no account values: the Hyperdrive id is a placeholder and `localConnectionString` points at a local Postgres. A real deployment keeps its own wrangler config in a private repository. Two settings matter for safety: `workers_dev` and `preview_urls` are `false`, because Cloudflare Access on a custom domain does not cover `workers.dev` or preview URLs.

`pnpm --filter @mitcsutt/embertrail-worker dry-run` bundles the Worker the way `wrangler deploy` would, with no account, and logs the bundle size. CI runs it.
