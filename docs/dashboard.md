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
pnpm --filter @mitcsutt/embertrail-dashboard e2e        # Playwright on Chromium, see End-to-end tests
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
    app/components/        # AppShell, BoardNav, JumpPalette, Providers, HubProvider, HubStatus
    app/utils/             # hubProblem: the copy for a Hub that can't be used
    config/runtimeConfig/  # config.json: load and validate
    lib/                   # configured clients, one module each (hub, queryClient)
    features/
      filters/             # types, utils (resolveWindow, toQueryContext), hooks, data, components
      widgets/             # the Widget framework and the first Catalogue entries, see Widgets
      boards/{types,schemas,utils,constants,data,hooks,components,pages}  # BoardDocument and its schema, Presets, the store, BoardView and BoardGrid, BoardPage
      sessions/pages/      # SessionGroupsPage, SessionPage
```

Routes: `/` redirects to `/boards/overview`; `/boards/$boardId` is the [Board view](#the-board-view); `/sessions` and `/sessions/$sessionId` render placeholder pages for now.

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

An absolute `TimeRange` is two `YYYY-MM-DD` calendar dates, both inclusive, read in the Dashboard's zone. Do not change a shape without a tidy-pass decision (#72). `test/contracts.test.ts` runs them against the test Hub and the client: a `QueryContext` feeds one `WidgetRequest` of each op (`queryMetrics`, `queryEvents`, `listSessions`), `getSelf` answers for the Dashboard's Token, and a `BoardDocument` is created, replaced and refused on a stale `ETag` in the `embertrail-dashboard` namespace.

## Filters

`features/filters` owns what a Board is filtered by: a time range and one Source, Account and model. It imports no other feature.

- **`resolveWindow(range, now, tz)`** turns a `TimeRange` into `{ from, to }`, UTC instants with `from` inclusive and `to` exclusive. Days are local calendar days in `tz`, so a day across a clock change is 23 or 25 hours; weeks start on Monday. Every range that includes today ends at the start of tomorrow, not at `now`, so a Widget's request stays the same all day and TanStack Query does not refetch it. `last-7-days` is today and the six days before it. `resolveFixedWindow` does the same for a Widget's fixed `window` (`today`, `this-week`, `last-28-days`, `last-12-weeks`); `absoluteRange` gives the dates a relative range covers (what the custom picker starts from). Never send a fixed offset as `tz`: the Hub answers 422. `browserTimeZone()` reads the IANA zone once at the edge.
- **`toQueryContext(filters, override, widget, now, tz)`** builds a Widget's `QueryContext`. A pinned override wins field by field (a field it leaves unset follows the Board). A Widget with a fixed `window` ignores the Board's range, even a pinned one. Source, Account and model become `embertrail.source_id`, `embertrail.account_id` and `model` `eq` filters, and the same values in `sessions` for `listSessions`; a filter the Widget does not list in `filters` is left out of both. It takes a `WidgetScope` (`window` and `filters`), which a `WidgetDefinition` satisfies.
- **The URL is the live state.** `useBoardFilters(saved)` reads the filters from the search params over the Board's `saved` ones and writes changes back, replacing the history entry and keeping other params. Keys: `range` (a relative range, or `custom` with `from` and `to`), `source`, `account` and `model`. A bare URL shows the saved filters; a value is written only where it differs from them, and an empty string means "all" for a pick the Board saved. A param that does not validate is ignored on its own (`filterSearchSchema`). Routes need no `validateSearch` for it, and the hook leaves other params alone. The hook returns `{ filters, setFilters, tz }`.
- **`data/inventory`** is `getInventory` for the current window, keyed `['inventory', from, to]`. `useInventory(client, window)` takes the client as an argument; the Board view passes `useHub()`'s.
- **`FilterBar`** is the control: a range `Select` (with "Custom…" opening a `DateRangePickerField`) and `Combobox` pickers for Source, Account and model, single-select because `GET /sessions` takes one of each. It is controlled (`filters`, `onChange(patch)`, `inventory`) and keyboard-operable: Tab between the controls, Enter or the arrow keys in each. The custom picker keeps its own draft and reports only a whole range whose start is not after its end. Account options use `Inventory.accounts[].label` with the email under it; a Source shows its name; the Owner is shown only when the Inventory holds more than one, and is an id until the Hub names it. A pick the window no longer holds is still offered, so it never disappears from the bar.

Tests: unit tests next to each module, including every relative range in Europe/Berlin and America/New_York on both clock-change days of 2026 (`resolveWindow.test.ts`), and `test/filters.test.ts` against the test Hub (the Inventory, and the filters `toQueryContext` maps against the demo facts).

## Boards

A Board is one JSON document in the `store` namespace `embertrail-dashboard`, read and written through `features/boards`. The shape is `BoardDocument` in `features/boards/types/board` (see [Shared contracts](#shared-contracts)).

- **Schema:** `features/boards/schemas/board` holds the zod schema, and `board.schema.json` next to it is the same structure as JSON Schema (draft 2020-12), generated from zod and checked by a snapshot test: after changing the schema, run `pnpm --filter @mitcsutt/embertrail-dashboard test -- -u` to rewrite the file. `schema_version` is `1`. JSON Schema covers the structure; zod also checks what it cannot say: item ids are unique, the Layout has exactly one cell per item, and no cell runs past column 12. A Board that comes back from the Hub is always parsed by zod, never trusted.
- **Migration:** `migrateBoard(stored)` (`utils/migrate`) lifts a stored Board of any older `schema_version` to the current one, step by step through `boardMigrations` (empty while v1 is the first version). It throws `UnsupportedBoardVersionError` for a newer version and `InvalidBoardError`, which names each problem, for anything that does not parse. Every read goes through it. To add version 2: bump `currentBoardVersion` and the schema, and add `boardMigrations[1]`.
- **Presets** (`utils/presets`) are data, not stored documents, and are frozen: **Overview** (the layout of #16), **Everything** (one section per Widget group in Catalogue order, each Widget at its default size, built by `everythingPreset(catalogue)` so a new Widget joins it) and **New Board** (empty). All three start on `last-7-days`. `overview`, `everything` and `new` are reserved ids; a stored Board id is `b-` and ten base36 characters (`newBoardId`). A Widget item's `i` is its Widget id in a Preset and a section's `i` is `section-<slug>`. `customisePreset(preset)` returns a copy named `<name> (copy)`, which `createBoard` then stores.
- **Queries** (`data/boards`): `useBoardList(client)` (key `['boards', 'list']`) and `useBoard(client, id)` (key `['store', 'embertrail-dashboard', id]`). Only a network failure, a proxy's 5xx or a Hub 5xx is retried, once; a missing, refused or unreadable Board is not.
- **Store** (`data/boards`) takes the client as its first argument: `listBoards` (the readable ones, and the ids it could not read), `getBoard` (keeps the `ETag`), `createBoard` (`If-None-Match: *`, a fresh id, retried on a taken one), `saveBoard` and `deleteBoard` (`If-Match`). A write that loses its race throws `BoardConflict` with `current`, the Hub's copy (`undefined` if the Board was deleted since, or if the new copy cannot be read, in which case `cause` holds the read error); the stored Board is untouched, and the caller decides whether to reload or keep editing.

### The Board view

`/boards/$boardId` runs `BoardPage`. A Preset id (`overview`, `everything`, `new`) resolves to its Preset (`presetBoard(id, catalogue)`); any other id is a stored Board, read and migrated by `useBoard`. A Board that does not exist shows "No such Board"; one that cannot be read (`InvalidBoardError`, an unsupported version) shows the reason with a Try again.

- **`BoardView`** (`components/BoardView`) is one Board in view mode: the name, the `FilterBar`, and the grid inside a `WidgetColorScope` (one colour per model across every chart; `features/widgets` owns it). The filters come from `useBoardFilters(board.filters)`, so the URL is the live state; the Inventory for the visible window fills the pickers. `now` is read once when the page mounts. An empty Board (the `new` Preset) shows "No Widgets on this Board yet".
- **`BoardGrid`** (`components/BoardGrid`) draws the stored 12-column Layout with kiln-dnd's `GridLayout` (`columns` 4, 8 and 12 by width, narrower ones generated from the stored one). View mode has no `DragHandle` and `resizable={false}`, so nothing moves. A `section` is an `h2`; a `widget` is a `Widget` with its own `QueryContext` (pinned `override` applied); a Widget id the Catalogue does not have is an "Unknown Widget" frame, and a `query` item a frame saying Query Widgets cannot be shown yet, so one item never takes the Board down.
- **Edit is not here yet.** "Customise" (Presets) and "Edit" (stored Boards) are disabled buttons shown when `useSelf().canEdit`; the Board editor replaces them (#72 D7).
- **Navigation** (`app/components`): `BoardNav` is the sidebar list (Presets, then stored Boards, then "New Board", which is the empty Preset), and `JumpPalette` is the `CommandPalette` on ⌘K or Ctrl+K (and a "Jump to…" button) over the same Boards and the Session Groups page. A Hub that refuses the Board list leaves the Presets. Both list `presetIds` in order, named by each Preset's own `name`.
- Features import each other's public kinds only, so `app` and `boards` reach `filters` and `widgets` through hooks and components (`useQueryContext`, `useResolvedWindow`, `usePresetList`, `WidgetColorScope`), not their `utils`.

## Widgets

A Widget is one entry of the Catalogue: a `WidgetDefinition` (see Shared contracts) that says what to ask the Hub (`request`), how to read the answer (`select`, `isEmpty`) and how to draw it (`View`). `features/widgets` holds the framework and the Catalogue. Ten Widgets from the first batches are the models for a new one, in #16's order: **Cost today** and **Cost this week** (stats; the week is a fixed window), **Each day by model** (a stacked `Bars` chart pivoted by model), **Cost by Account** (`Bars`, an Account named by its Inventory label), **Sessions today** (a stat), **Top sessions** (a `Table` linking to `/sessions/$sessionId`), **Sessions per day** (`Bars` stacked by `start_type`), **Model mix** (`Share`), **Cache share** (a stat: cacheRead ÷ (input + cacheRead + cacheCreation), empty when no input was counted) and **Tokens by type** (a stacked `TimeSeries`). The two `session.count` Widgets leave `model` out of their `filters`: that metric has no model.

Batch B adds ten more, following #16's table:

| Group         | Widgets                                                                                                                                |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `tools`       | **Top tools** (`BarList`, ten at most), **Tool failures** (a `Table` with a failure rate), **Edit acceptance** (`Share`)               |
| `output`      | **Lines changed per day** (stacked `Bars`), **Commits per day** (`Bars`)                                                               |
| `rhythm`      | **Today by hour vs typical** (`Chart`, a dashed typical line), **When you work** (`Heatmap`), **Active time per day** (stacked `Bars`) |
| `reliability` | **API errors** (stacked `Bars` by status), **Request latency** (p95 `TimeSeries` by model)                                             |

```
features/widgets/
  components/
    Widget/                  # useWidgetData + WidgetFrame + the definition's View: what a Board renders
    WidgetFrame/             # the Card, and loading, empty and error in place of the View
    CostToday/ EachDayByModel/ TopSessions/ …  # one module per Widget: definition and View together
  constants/catalogue/       # catalogue: WidgetDefinition[], getWidget(id)
  data/runRequest/           # a switch over WidgetRequest.op onto the client
  hooks/useWidgetData/       # the only path from a Widget to the Hub (lint enforces it)
  utils/                     # formats, chartColorOrder, describeError, asCatalogueEntry,
                             # aggregateRows, chartBucket, localHours
```

- **One query per Widget**, keyed on the exact request (`['widget', request]`). A filter change that builds a new request refetches that Widget once; one that builds the same request (a Board filter the Widget ignores, a pinned override) does not. A 4xx the Hub answered is not retried; a 5xx or a network failure is retried once.
- **The frame** maps `loading`, `empty` and `error` onto kiln-charts' `ChartFrame`. An error shows the Hub's `detail` when it sent one, with a Retry; `empty` is what `isEmpty(data)` says (no rows, or a sender that sends no cost). The `View` is drawn only when the status is `ready`. A `stat` leaves the title to its `Stat`.
- **The Inventory** reaches a Widget that names things by it. A definition with `inventory: true` (Cost by Account, for Account labels) gets the window's Inventory from `useWidgetData` and as `View`'s `inventory` prop. It is the query the filter bar runs for the same window, so on a Board it costs no extra request. The Widget stays loading until the Inventory answers; if that fails it still draws, with ids for names. Other Widgets never ask for it.
- **The Hub client** is `useHub().client` (`#lib/hub`), read only inside `useWidgetData`. ESLint stops anything else under `features/widgets` (tests aside) from importing `#lib/hub` or `runRequest`, so a Widget cannot reach the Hub another way. A test mounts a `HubContext` with the client it wants.
- **Formats** (`utils/formats`) write dollars, token counts, percentages and durations in the browser's locale. `chartColorOrder({ models, types })` is the `order` for the Board-wide `ChartColorScope`, so a model keeps its colour in every chart.
- **A Widget's window and filters** are already resolved into the `QueryContext` it gets. `toQueryContext` (`features/filters`) is the only code that builds one, in the app and in tests: `request(ctx)` uses `ctx.from`, `ctx.to`, `ctx.tz` and `ctx.filter` and leaves a `filter` out when it is empty.

- **Aggregate answers** (`utils/aggregateRows`) are the `rows` of a `queryMetrics` or an `aggregate`-mode `queryEvents` response; every Widget that reads them selects through it. An Events request keeps its `event.name` filter first and appends `ctx.filter`, and an Event Widget lists a Board filter only if the Event carries that attribute (`tool_result` has no `model`, `api_request` and `api_error` do).
- **Time charts pick their bucket from the window** (`utils/chartBucket`): hours for a window of two days or less, days beyond. Empty buckets are omitted and charts space points evenly, so hourly points over a week would be mostly gaps.
- **Local hours** (`utils/localHours`) is how the two Rhythm Widgets read hourly buckets. A bucket's local day, hour and weekday come from its instant in the zone (`@date-fns/tz`), never from its string. `foldWeek` sums buckets into Monday-first weekday × hour cells ("When you work"). `todayVsTypical` gives each local hour today's total (blank for hours not reached) and the mean of the window's other days; on a 23 hour day the skipped hour is left out of that hour's mean (the day does not count as zero), and on a 25 hour day the repeated hour adds both occurrences.

### Writing a Widget

Adding a Widget to the Catalogue is mechanical. Take `CostToday` (a stat), `EachDayByModel` (a chart) or `TopSessions` (a table) as the model for its kind.

1. **Add a module** `features/widgets/components/<WidgetName>/` with `<WidgetName>.tsx` and an `index.ts` that exports the definition and its data type. The module holds the whole Widget: `export const widgetName: WidgetDefinition<WidgetNameData>` and its `View`. Folders inside it are rejected by the structure lint.
2. **Fill the definition.** `id` is stable and kebab-case (Boards store it, so never rename it); `group`, `title`, `kind`, `size` (and `minSize`) place it. Set `window` to `board`, or to a fixed window if the Widget ignores the Board's range, and list in `filters` only the Board filters the Widget's metric carries: `session.count` has no `model`, so `model` stays out of its list.
3. **`request(ctx)`** returns a `WidgetRequest` built from `ctx.from`, `ctx.to`, `ctx.tz` and `ctx.filter` (leave `filter` out when it is empty); `listSessions` Widgets use `ctx.sessions`. Copy the body from `packages/otel/src/query/widgets.test.ts`, which proves it against the Hub. Never build a `QueryContext` yourself, never send a fixed offset as `tz`, and keep a request free of anything that changes while the page is open, because the query is keyed on it.
4. **`select(response, ctx)`** turns the response into the data the View needs, `isEmpty(data)` says when there is nothing to draw (no rows, or a sender that sends no such metric: never draw zeros), and `View` draws it. Use `utils/formats` for numbers and `chartColorOrder` for series colours.
   A Widget that must name an Account (or another Inventory entry) sets `inventory: true` and reads `inventory` in `View`; it never calls the Hub itself.
5. **Register it** in `constants/catalogue/catalogue.ts` with `asCatalogueEntry(widgetName)`, in the order of #16's table. `everythingPreset` picks it up.
6. **Test it** (see below): one block in `test/widgets.test.ts` for the data, nothing else for the empty state and the spec check, which run over the Catalogue.

Do not call the client from a Widget. `useWidgetData` does, and nothing else under `features/widgets` may.

### Testing a Widget

`test/spec.ts` checks a request against `spec/query-api.yaml` itself: a body against the operation's request schema, `listSessions`' query against its parameters (an unknown parameter fails). `test/widget.ts` is the template: `testContext(widget, now, filters?)` builds the Widget's `QueryContext` with `toQueryContext` (the Board's range is the last 90 days, which holds the demo dataset; a fixed window is the Widget's own, and `filters` are Board filters), `loadWidget(client, definition, ctx)` validates the request, sends it through the real client and returns the selected data. A Widget's tests then:

1. assert the selected data against `demo.facts` on the demo Hub (`test/widgets.test.ts`),
2. add the Widget to the Catalogue so `test/widgets-empty.test.ts` asserts it is empty on a Hub that only holds a non-Claude sender, and the spec check covers its request,
3. render its `View` from a stub client in `Widget.test.tsx` (or `Widget.views.test.tsx`, which covers the Tools, Output, Rhythm and Reliability Widgets) when it draws something new.

`test/otlp.ts` reads the dataset's own OTLP back (`pointsOf`, `eventsOf`) and `wallClock` reads an instant on a zone's clock with `Intl` alone, so a test can work out what a Widget should show from what was sent without going through the Hub or the Widget. `test/widgets-tools-output-reliability.test.ts` does that for ten Widgets; `test/widgets-rhythm.test.ts` runs the two Rhythm Widgets in Europe/Berlin and America/New_York on a Hub whose data spans the spring clock changes (a 23 hour day) and one that spans the autumn ones (25 hours).

kiln-charts needs `ResizeObserver` and `matchMedia`, which jsdom lacks; `test/vitest.setup.ts` stubs both, so a chart renders its frame and hidden data table but is never laid out. Assert on the table, and check pointer behaviour in the browser.

## Component tests

`test/fakeHub.ts` is an in-memory Hub for tests that render the app: `fakeHub({ boards?, scopes? })` returns a real client whose `fetch` answers `getSelf`, `getInventory`, the three Query API operations (empty results) and reading Boards, plus `requests` and `widgetRequests()` for what was asked. PGLite does not boot under jsdom, so a `.tsx` test cannot use `dashboardTestHub`; use `fakeHub` for UI behaviour and the test Hub (a `// @vitest-environment node` file) for what the Hub does with a request. `test/boards.test.tsx` is the reference: it renders the real route tree and asserts what each Preset and a stored Board draw, that a filter change asks only the affected Widgets again, and the navigation and palette.

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

`pnpm test` at the root takes about 2 min 40 s with a cold cache, and the Dashboard's part of that is about 11 s: one PGLite Hub per test file, booted in `beforeAll` (`demo.test.ts`, `contracts.test.ts`, `filters.test.ts` and `seed.test.ts` each boot one; a boot plus the dataset takes about 3 s). Turbo runs packages one at a time (`--concurrency=1`). Keep to one Hub per file as Widget tests arrive; re-measure at each tidy pass. The exception is `widgets-rhythm.test.ts`, which boots two (data across the spring and the autumn clock changes) and takes about 17 s alone; with Catalogue batch B the Dashboard's 37 files run in about 29 s.

## End-to-end tests

`apps/dashboard/e2e/` holds the browser specs (Playwright, Chromium only). They are not part of `pnpm test`; CI runs them as the `Dashboard e2e` job, which is in the `CI passed` needs list. Locally:

```sh
pnpm --filter @mitcsutt/embertrail-dashboard exec playwright install chromium   # once
pnpm --filter @mitcsutt/embertrail-dashboard e2e
```

- `e2e/global-setup.ts` calls `startStack()` in `e2e/stack.ts` once per run: `dashboardTestHub({ now: new Date() })` (the demo dataset, ending now so every relative range holds data) served over HTTP with `@hono/node-server`, then `vite build`, then three `vite preview` servers whose proxies point at that Hub. All ports are random. Each preview's proxy reads `EMBERTRAIL_HUB` and `EMBERTRAIL_TOKEN` like `pnpm dev`, so the specs exercise the real proxy path. Playwright's own TypeScript loader runs the setup, which is how it can import the Hub's TypeScript source that plain Node cannot.
- The three previews make the failure states real: **working** (the Hub's Token), **unauthorized** (a Token the Hub refuses, so a real 401) and **unreachable** (a port nothing listens on, so the proxy's real error). The setup puts their origins in `E2E_ORIGIN`, `E2E_ORIGIN_UNAUTHORIZED` and `E2E_ORIGIN_UNREACHABLE`; `e2e/origins.ts` reads them.
- `e2e/requests.spec.ts` is the request allowlist (#40): every request the page makes must be to its own origin, and the only API path is `/api/`. A request to another origin fails the spec.
- `e2e/axe.ts` exports `expectNoAxeViolations(page, ready)`: it stores `light` then `dark` under `embertrail-dashboard-mode`, reloads, waits for `ready` and fails on any axe violation. jsdom cannot compute colour contrast, so axe runs here and not in Vitest. A new page adds a spec that calls it.
- Specs wait on what the page shows (a locator), never on a timeout. On a CI failure the job uploads `test-results/` (traces) and `playwright-report/`.
