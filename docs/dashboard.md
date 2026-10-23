# Dashboard

The Dashboard (`apps/dashboard`, `@mitcsutt/embertrail-dashboard`, private) is a static single-page app that reads the Hub's Query API. The design is epic #51; the build plan is #72. This page is the canonical Dashboard doc: it grows with each task.

## Stack

- Vite 8 and React 19, with [Kiln](https://kiln.mitchellsutton.com): `kiln-ui` for the shell, `kiln-charts` for charts and `kiln-dnd` for the Board grid. The Paper theme is set before first paint by a script that the Vite config writes into `index.html`; the colour mode is stored under `embertrail-dashboard-mode`.
- TanStack Router (file routes in `src/routes/`, the generated `src/routeTree.gen.ts` is committed) and TanStack Query.
- The Dashboard reaches the Hub only through `@mitcsutt/embertrail-client`. ESLint bans every other workspace package and `fetch`, `XMLHttpRequest`, `EventSource` and `WebSocket` in `src/`, test files included.

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
