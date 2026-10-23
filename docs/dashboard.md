# Dashboard

The Dashboard (`apps/dashboard`, `@mitcsutt/embertrail-dashboard`, private) is a static single-page app that reads the Hub's Query API. The design is epic #51; the build plan is #72. This page is the canonical Dashboard doc: it grows with each task.

## Stack

- Vite 8 and React 19, with [Kiln](https://kiln.mitchellsutton.com): `kiln-ui` for the shell, `kiln-charts` for charts and `kiln-dnd` for the Board grid. The Paper theme is set before first paint by a script that the Vite config writes into `index.html`; the colour mode is stored under `embertrail-dashboard-mode`.
- TanStack Router (file routes in `src/routes/`, the generated `src/routeTree.gen.ts` is committed) and TanStack Query.
- The Dashboard reaches the Hub only through `@mitcsutt/embertrail-client`. ESLint bans every other workspace package and `fetch`, `XMLHttpRequest`, `EventSource` and `WebSocket` in `src/`; test files are exempt.

## Commands

From the repo root, filter to the package:

```sh
pnpm --filter @mitcsutt/embertrail-dashboard dev        # the shell on a Vite dev server
pnpm --filter @mitcsutt/embertrail-dashboard build      # dist/
pnpm --filter @mitcsutt/embertrail-dashboard preview    # serve dist/
pnpm --filter @mitcsutt/embertrail-dashboard test       # Vitest on jsdom
```

`pnpm lint`, `pnpm typecheck` and `pnpm test` at the root cover it too.

## Layout

The layout follows Kiln's app structure ([ADR 0037](https://github.com/mitcsutt/kiln/blob/main/docs/adr/0037-app-structure.md)), enforced by `@mitcsutt/kiln-structure/eslint` from the root `eslint.config.js`: a file lives with its closest common owner, children are grouped by kind folder (`components`, `hooks`, `stores`, `utils`, `constants`, `types`, `schemas`), and every module is a folder with a narrow `index.ts`. Imports use `#` (`#features/boards/pages/BoardPage`, `#lib/queryClient`), never `../`.

```
apps/dashboard/
  index.html  vite.config.ts  vitest.config.ts
  test/                    # test setup, outside src/
  src/
    main.tsx               # entry: styles, router, providers
    routes/                # thin file routes
    app/components/        # AppShell, Providers (the composition root)
    lib/                   # configured clients, one module each
    features/
      filters/types/       # BoardFilters, QueryContext
      widgets/types/       # WidgetDefinition
      boards/{types,pages/}  # BoardDocument, BoardPage
      sessions/pages/      # SessionGroupsPage, SessionPage
```

Routes: `/` redirects to `/boards/overview`; `/boards/$boardId`, `/sessions` and `/sessions/$sessionId` render placeholder pages for now.

### Feature graph

A feature imports another only along a declared edge (the `features` option in `eslint.config.js`; add a new feature there first):

| Feature    | May import           |
| ---------- | -------------------- |
| `boards`   | `widgets`, `filters` |
| `widgets`  | `filters`            |
| `sessions` | `filters`            |
| `filters`  | none                 |

## Shared contracts

The types that let tasks run in parallel are committed first and later tasks fill in the behaviour around them:

- `features/filters/types/filters`: `TimeRange`, `BoardFilters`, `FilterOverride`, `QueryContext`.
- `features/widgets/types/widget`: `WidgetDefinition` and the unions it uses (`WidgetKind`, `WidgetGroup`, `WidgetWindow`, `WidgetRequest`).
- `features/boards/types/board`: `BoardDocument`, `BoardItem`, `QueryWidgetConfig`, `boardNamespace` (`embertrail-dashboard`) and the reserved Preset ids.

Do not change a shape without a tidy-pass decision (#72).

## Demo data

`apps/dashboard/test/demo/` makes a deterministic five weeks of one person's Claude Code Sessions as the OTLP/HTTP JSON the Hub takes. The Dashboard's tests, `pnpm seed` and the end-to-end suite all use it, so a Widget is tested against the same data you see in the browser.

```ts
import { demoDataset } from './test/demo/index.ts'

const { otlp, labels, facts, options } = demoDataset({
  now,
  tz: 'Europe/Berlin',
  days: 35,
  seed: 1,
})
```

- **Options:** `now` (nothing is generated after it; default `demoNow`, a Wednesday afternoon after both clock changes), `tz` (the zone of the working day), `days` (35), `seed` (1), and `sender: 'other'` for a sender that isn't Claude Code, for empty-state tests. The same options always give the same payloads.
- **What it covers:** every Metric and Event the 20 curated Widgets read (`cost.usage` by model, `token.usage` by type, `session.count` by `start_type`, `code_edit_tool.decision`, `lines_of_code.count`, `commit.count`, `active_time.total`, and the `tool_result`, `api_error` and `api_request` Events); two Accounts (`dev@example.com` with an organization, `dev@example.org` without); three models; a weekday working rhythm with a lighter evening and weekend; on the day `tz` changes its clock, one long Session that starts just before the change and runs across it (Berlin on 25 October and New York on 1 November 2026 are both in the default window).
- **Session Groups:** three groups made with `embertrail.group.*` resource attributes, `embertrail.parent.session_id` and `embertrail.role`: `billing-migration` (an orchestrator, workers and their subagents: **three levels deep**), `docs-sweep` (two levels) and `flaky-tests`. Two Labels then regroup Sessions after the fact: one worker of `billing-migration` moves to `docs-sweep`, and one ungrouped Session joins `flaky-tests`. A reserved Label wins over the attribute, so a Hub holding the Labels sees the new groups and a Hub without them the old ones.
- **Quirks kept** from the Claude Code fixtures: `intValue` as a JSON number, every data point `asDouble`, `event.name` unprefixed beside the `claude_code.`-prefixed body, `event.sequence` and `event.timestamp` on every Event, identity attributes on every record.
- **`facts`** are computed from the payloads the generator returns, so a test can assert exact numbers: `costToday`, `costThisWeek`, `sessionsToday`, `cost`, `costByModel`, `costByAccount`, event and data point counts, and per Session and per group the cost (a group's total is the sum of its members). They use local days in `tz`, which are 23 or 25 hours across a clock change.

The generator is plain TypeScript with explicit `.ts` imports and imports nothing from the workspace, so Node 24 runs it as it is (that is how `pnpm seed` uses it). It lives outside `src/`, so the client-only lint rule does not apply to it ([`eslint.config.js`](../eslint.config.js)); `tsconfig.json` sets `rewriteRelativeImportExtensions` for the same reason.

For the default options (`--now 2026-11-04T13:00:00Z --tz Europe/Berlin`): 157 Sessions, 5,722 Events and 8,480 data points.

## Seeding a Hub

With a Hub running ([`self-hosting.md`](self-hosting.md)) and the `embertrail` CLI logged in to it:

```sh
docker compose up -d
embertrail login --hub http://localhost:8787 --token <the Token the first start printed>
pnpm --filter @mitcsutt/embertrail-dashboard seed
```

`seed` takes the Hub and Token from `embertrail login`, or from `EMBERTRAIL_HUB` and `EMBERTRAIL_TOKEN` when both are set. It deletes the Source `embertrail-demo` if there is one (a hard delete removes every row it sent), creates it again, posts the dataset with the new Source's ingest Token, sets the Labels, and reads the counts back for that Source, failing if the Hub does not hold exactly what was sent. Running it again leaves the same rows. Other Sources on the Hub are never touched.

`--days` and `--seed` must be positive integers; `--now` must be a time. Anything else fails before the Hub is contacted.

| Flag          | Default                                                                          |
| ------------- | -------------------------------------------------------------------------------- |
| `--now <iso>` | the top of the current hour, so a re-run within the hour sends identical Signals |
| `--tz <zone>` | this machine's zone                                                              |
| `--days <n>`  | 35                                                                               |
| `--seed <n>`  | 1                                                                                |

Against a fresh `docker compose up`, two runs with `--now 2026-11-04T13:00:00Z --tz Europe/Berlin` each print `{"sessions":157,"events":5722,"points":8480}`.

## Testing against a Hub

`test/hub.ts` exports `dashboardTestHub({ now?, demo?, labels? })`, the real Hub on PGLite with the Modules a Hub ships, the dataset ingested through a Source-bound Token, and a client that reads it the way the Dashboard does:

```ts
const { t, client, demo, applyLabels, close } = await dashboardTestHub()
const { rows } = await client.queryMetrics({
  body: {
    metric: 'claude_code.cost.usage',
    aggregation: 'sum',
    ...demo.facts.today,
    tz: 'Europe/Berlin',
  },
})
```

- `demo: false` leaves the Hub empty; `demo: { sender: 'other' }` gives the empty-state data; `labels: false` holds the Labels back until `applyLabels()`.
- Boot one Hub per test file in `beforeAll` and seed it once: booting PGLite and ingesting the dataset takes several seconds.
- `test/demo/demo.test.ts` is the reference: it checks the facts against what the Hub reads back, the group totals, the Label moves, and runs all 20 curated Widget requests (the ones in `packages/otel/src/query/widgets.test.ts`) against the dataset. `test/seed.test.ts` runs `pnpm seed` twice against a Hub over HTTP on a random port.
