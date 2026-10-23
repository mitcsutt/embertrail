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

### The development loop

```sh
docker compose up -d                                              # the Hub, on 127.0.0.1:8787
embertrail login --hub http://localhost:8787 --token <the Token the first start printed>
pnpm --filter @mitcsutt/embertrail-dashboard seed                 # the demo dataset, see below
pnpm --filter @mitcsutt/embertrail-dashboard dev                  # the Dashboard on Vite
```

The first three steps are [Seeding a Hub](#seeding-a-hub); a Hub that already holds your own data works too, since `seed` only touches its own Source. `dev` (and `preview`) proxy `/api` to the Hub and add the Token, so after `embertrail login` the loop needs no further setup. See [Reaching the Hub](#reaching-the-hub).

## Reaching the Hub

The Hub allows no cross-origin requests, so the Dashboard is served from the same origin as the Hub's API behind a proxy that also holds the Token: it never reaches the browser.

- **`config.json`** (`public/config.json`, read at start with `cache: 'no-store'`, so a reload picks up an edit and no rebuild is needed): `{ "hubUrl": "", "headers"?: { … } }`. `hubUrl: ""` (the default) is the page's own origin; otherwise an absolute `http(s)` URL, which must allow the browser (the Hub does not yet send CORS headers, so this suits a Hub that is served from the same origin). `headers` are sent with every request, for an access proxy that wants a static header. The file is checked with zod; a bad file shows a message naming the field. It is the one request that does not go through the client (a justified `eslint-disable` in `src/config/runtimeConfig`).
- **`pnpm dev` and `pnpm preview`** proxy `/api` to the Hub and add `Authorization: Bearer <Token>` (`scripts/hubProxy.ts`, used by `vite.config.ts`). The Hub is `EMBERTRAIL_HUB`, else the one `embertrail login` stored, else `http://localhost:8787`. The Token is `EMBERTRAIL_TOKEN`, else the stored one, and a stored Token is sent only to the Hub it was stored for. The Token must hold `otel:read`, `store:read` and `store:write` and must not be bound to one Source (`getSelf` refuses those). The proxy refuses (404) any `/api` request from another origin (`Sec-Fetch-Site` or `Origin`), since a simple cross-site request would otherwise be written as you. Vite prints the Hub it proxies to, never the Token.
- **The Hub client** is one `createClient` built from the config in `src/lib/hub` (`createHub`, `useHub()`, `useSelf()`), provided by `HubProvider` in `app/components`. Only data modules call it.
- **`HubStatus`** (`app/components/HubStatus`) wraps the router: it loads the config, builds the client and calls `getInventory` once before rendering the app. A bad file, an unreachable Hub (a network error, a proxy's 502/503/504, or Vite's bare 500 when the Hub is down), a 401 and a 403 each show a message that names the address in use (this page's origin when `hubUrl` is empty), with a "Try again" button. The copy is in `app/utils/hubProblem`.
- **`useSelf()`** returns the Hub's `getSelf` answer (the header shows "Signed in as …") and `canEdit` (the Token holds `store:write`). A Hub without `getSelf`, or a failed call, leaves `self` undefined and `canEdit` true, so editing is not hidden by a missing endpoint; a write reports its own 403.

## Layout

The layout follows Kiln's app structure ([ADR 0037](https://github.com/mitcsutt/kiln/blob/main/docs/adr/0037-app-structure.md)), enforced by `@mitcsutt/kiln-structure/eslint` from the root `eslint.config.js`: a file lives with its closest common owner, children are grouped by kind folder (`components`, `hooks`, `stores`, `utils`, `constants`, `types`, `schemas`), and every module is a folder with a narrow `index.ts`. Imports use `#` (`#features/boards/pages/BoardPage`, `#lib/queryClient`), never `../`; `#test/hub` reaches `test/hub.ts` from a test file in `src/`.

```
apps/dashboard/
  index.html  vite.config.ts  vitest.config.ts
  public/config.json       # runtime config
  scripts/                 # seed.ts, hubProxy.ts (the dev proxy's Hub and Token)
  test/                    # test setup, Hub harness, demo data, spec check: outside src/
  src/
    main.tsx               # entry: styles, router, providers
    routes/                # thin file routes
    app/components/        # AppShell, Providers, HubProvider, HubStatus
    app/utils/             # hubProblem: the copy for a Hub that can't be used
    config/runtimeConfig/  # config.json: load and validate
    lib/                   # configured clients, one module each (hub, queryClient)
    features/
      filters/types/       # BoardFilters, QueryContext
      widgets/             # the Widget framework and the first Catalogue entries, see Widgets
      boards/{types,schemas,utils,data,pages}  # BoardDocument and its schema, Presets, the store, BoardPage
      sessions/pages/      # SessionGroupsPage, SessionPage
```

Routes: `/` redirects to `/boards/overview`; `/boards/$boardId`, `/sessions` and `/sessions/$sessionId` render placeholder pages for now.

What the structure rule allows, so a new folder does not fail lint after the code is written:

- Inside a feature (`src/features/<name>/`), a module folder sits inside one of `components`, `hooks`, `stores`, `utils`, `constants`, `types`, `schemas`, `pages` or `data`. Nothing else is a folder name there, and a module folder cannot hold another module folder. (`src/app`, `src/config`, `src/lib` and `src/routes` are the top-level folders.) A `lib/` module is one file named after it plus `index.ts`, so a component goes in `app/components`. A Catalogue of 20 Widgets is therefore flat module folders (one per Widget) in `features/widgets/utils/` or `components/`, not a `catalogue/` folder.
- `test/`, `scripts/` and `e2e/` sit outside `src/`, so the structure rule and the client-only rule do not apply to them; the React and base lint rules do. `tsconfig.json` includes all three (the type-aware lint needs a file in a tsconfig), so a new top-level folder of code needs adding there too.

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

Do not change a shape without a tidy-pass decision (#72). `test/contracts.test.ts` runs them against the test Hub and the client: a `QueryContext` feeds one `WidgetRequest` of each op (`queryMetrics`, `queryEvents`, `listSessions`), `getSelf` answers for the Dashboard's Token, and a `BoardDocument` is created, replaced and refused on a stale `ETag` in the `embertrail-dashboard` namespace.

## Boards

A Board is one JSON document in the `store` namespace `embertrail-dashboard`, read and written through `features/boards`. The shape is `BoardDocument` in `features/boards/types/board` (see [Shared contracts](#shared-contracts)).

- **Schema:** `features/boards/schemas/board` holds the zod schema, and `board.schema.json` next to it is the same structure as JSON Schema (draft 2020-12), generated from zod and checked by a snapshot test: after changing the schema, run `pnpm --filter @mitcsutt/embertrail-dashboard test -- -u` to rewrite the file. `schema_version` is `1`. JSON Schema covers the structure; zod also checks what it cannot say: item ids are unique, the Layout has exactly one cell per item, and no cell runs past column 12. A Board that comes back from the Hub is always parsed by zod, never trusted.
- **Migration:** `migrateBoard(stored)` (`utils/migrate`) lifts a stored Board of any older `schema_version` to the current one, step by step through `boardMigrations` (empty while v1 is the first version). It throws `UnsupportedBoardVersionError` for a newer version and `InvalidBoardError`, which names each problem, for anything that does not parse. Every read goes through it. To add version 2: bump `currentBoardVersion` and the schema, and add `boardMigrations[1]`.
- **Presets** (`utils/presets`) are data, not stored documents, and are frozen: **Overview** (the layout of #16), **Everything** (one section per Widget group in Catalogue order, each Widget at its default size, built by `everythingPreset(catalogue)` so a new Widget joins it) and **New Board** (empty). All three start on `last-7-days`. `overview`, `everything` and `new` are reserved ids; a stored Board id is `b-` and ten base36 characters (`newBoardId`). A Widget item's `i` is its Widget id in a Preset and a section's `i` is `section-<slug>`. `customisePreset(preset)` returns a copy named `<name> (copy)`, which `createBoard` then stores.
- **Store** (`data/boards`) takes the client as its first argument: `listBoards` (the readable ones, and the ids it could not read), `getBoard` (keeps the `ETag`), `createBoard` (`If-None-Match: *`, a fresh id, retried on a taken one), `saveBoard` and `deleteBoard` (`If-Match`). A write that loses its race throws `BoardConflict` with `current`, the Hub's copy (`undefined` if the Board was deleted since, or if the new copy cannot be read, in which case `cause` holds the read error); the stored Board is untouched, and the caller decides whether to reload or keep editing.

## Widgets

A Widget is one entry of the Catalogue: a `WidgetDefinition` (see Shared contracts) that says what to ask the Hub (`request`), how to read the answer (`select`, `isEmpty`) and how to draw it (`View`). `features/widgets` holds the framework and the Catalogue; three Widgets exist so far, one per pattern: **Cost today** (a stat), **Each day by model** (a stacked `Bars` chart pivoted by model) and **Top sessions** (a `Table` linking to `/sessions/$sessionId`).

```
features/widgets/
  components/
    Widget/                  # useWidgetData + WidgetFrame + the definition's View: what a Board renders
    WidgetFrame/             # the Card, and loading, empty and error in place of the View
    WidgetClientProvider/    # gives Widgets the Hub client
    CostToday/ EachDayByModel/ TopSessions/   # one module per Widget: definition and View together
  constants/catalogue/       # catalogue: WidgetDefinition[], getWidget(id)
  data/runRequest/           # a switch over WidgetRequest.op onto the client
  hooks/useWidgetData/       # the only path from a Widget to the Hub
  utils/                     # formats, chartColorOrder, describeError, asCatalogueEntry
```

- **One query per Widget**, keyed on the exact request (`['widget', request]`). A filter change that builds a new request refetches that Widget once; one that builds the same request (a Board filter the Widget ignores, a pinned override) does not. A 4xx the Hub answered is not retried; a 5xx or a network failure is retried once.
- **The frame** maps `loading`, `empty` and `error` onto kiln-charts' `ChartFrame`. An error shows the Hub's `detail` when it sent one, with a Retry; `empty` is what `isEmpty(data)` says (no rows, or a sender that sends no cost). The `View` is drawn only when the status is `ready`. A `stat` leaves the title to its `Stat`.
- **The Hub client** comes from `WidgetClientProvider`. Until the runtime config and `HubStatus` gate land (#72 D2) nothing mounts it; the app will mount it with the client it builds from the config.
- **Formats** (`utils/formats`) write dollars, token counts, percentages and durations in the browser's locale. `chartColorOrder({ models, types })` is the `order` for the Board-wide `ChartColorScope`, so a model keeps its colour in every chart.
- **A Widget's window and filters** are already resolved into the `QueryContext` it gets: `request(ctx)` uses `ctx.from`, `ctx.to`, `ctx.tz` and `ctx.filter` and leaves a `filter` out when it is empty.

### Testing a Widget

`test/spec.ts` checks a request against `spec/query-api.yaml` itself: a body against the operation's request schema, `listSessions`' query against its parameters (an unknown parameter fails). `test/widget.ts` is the template: `testContext(window)` builds a `QueryContext`, `loadWidget(client, definition, ctx)` validates the request, sends it through the real client and returns the selected data. A Widget's tests then:

1. assert the selected data against `demo.facts` on the demo Hub (`test/widgets.test.ts`),
2. add the Widget to the Catalogue so `test/widgets-empty.test.ts` asserts it is empty on a Hub that only holds a non-Claude sender, and the spec check covers its request,
3. render its `View` from a stub client in `Widget.test.tsx` when it draws something new.

kiln-charts needs `ResizeObserver` and `matchMedia`, which jsdom lacks; `test/vitest.setup.ts` stubs both, so a chart renders its frame and hidden data table but is never laid out. Assert on the table, and check pointer behaviour in the browser.

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

### Test time

`pnpm test` at the root takes about 2 min 40 s with a cold cache, and the Dashboard's part of that is about 11 s: one PGLite Hub per test file, booted in `beforeAll` (`demo.test.ts`, `contracts.test.ts` and `seed.test.ts` each boot one; a boot plus the dataset takes about 3 s). Turbo runs packages one at a time (`--concurrency=1`). Keep to one Hub per file as Widget tests arrive; re-measure at each tidy pass.
