# @mitcsutt/embertrail-client

A typed client for an Embertrail Hub's Query API, its `store` documents and session Labels. Its types and operations are generated from [`spec/query-api.yaml`](../../spec/query-api.yaml), so they follow the spec exactly. It runs in browsers and on Node 24, and its only runtime dependency is `fetch`.

## Use

```ts
import { createClient, isProblemError, items } from '@mitcsutt/embertrail-client'

const hub = createClient({
  baseUrl: 'http://localhost:8787', // '' for the page's own origin
  token: process.env.EMBERTRAIL_TOKEN, // omit behind an Edge Identity
})

const cost = await hub.queryMetrics({
  body: {
    metric: 'claude_code.cost.usage',
    aggregation: 'sum',
    from: '2026-10-01T00:00:00Z',
    to: '2026-10-08T00:00:00Z',
    tz: 'Europe/Berlin',
    bucket: 'day',
    group_by: ['model'],
  },
})
```

There is one method per operation, named by its `operationId`: `queryMetrics`, `queryEvents`, `listSessions`, `getSession`, `putSessionLabels`, `getInventory`, `runSql`, `listStoreDocuments`, `getStoreDocument`, `putStoreDocument`, `deleteStoreDocument` and `getOpenApi`. Each takes one object whose keys follow where the spec puts each input:

| Key      | What goes in it                                           |
| -------- | --------------------------------------------------------- |
| `path`   | Path parameters, such as `{ session_id }`                 |
| `query`  | Query parameters; arrays repeat the parameter (`label`)   |
| `header` | Request headers the operation defines, such as `If-Match` |
| `body`   | The JSON request body                                     |
| `signal` | An `AbortSignal` for this call                            |

A method resolves to the response body. An operation whose response declares headers resolves to `{ data, headers }` instead, so a `store` write can be made conditional on the last read:

```ts
const path = { namespace: 'my-app', id: 'settings' }
const { data: settings, headers } = await hub.getStoreDocument({ path })

await hub.putStoreDocument({
  path,
  header: { 'If-Match': headers.ETag ?? undefined },
  body: { data: { ...(settings.data as object), theme: 'dark' } },
})
```

`createClient` also takes `headers` (sent with every request) and `fetch` (to use a different implementation, such as one that adds tracing).

### Errors

Every `/api/v1` error is an RFC 9457 problem, and the client throws it as a `ProblemError` carrying `type`, `status`, `title`, `detail`, `request_id`, `errors` (field errors on `validation`) and the whole body as `problem`. Branch on `type`, never on `title` or `detail`:

```ts
try {
  await hub.putStoreDocument({ path, header: { 'If-None-Match': '*' }, body: { data } })
} catch (error) {
  if (isProblemError(error, 'urn:embertrail:problem:precondition-failed')) {
    // the id is taken: read it, merge, retry with If-Match
  } else {
    throw error
  }
}
```

`problemTypes` lists every `type` the spec defines; a newer Hub may send others, which pass through unchanged. A failure without a problem body (a proxy's 502, say) or a success that isn't JSON throws `UnexpectedResponseError` with `status` and the raw `body`.

### Pages

Lists return `{ items, next_cursor }`. `items()` follows the cursors and yields every item; `pages()` yields whole pages. Each gets the cursor to send (`undefined` first), and the query must stay the same across pages:

```ts
for await (const session of items((cursor) =>
  hub.listSessions({ query: { from: '2026-10-01T00:00:00Z', cursor } }),
)) {
  console.log(session.id, session.cost_usd)
}
```

`queryEvents` answers an Event list or aggregate rows depending on `mode`, so narrow its result before paging:

```ts
const events = items(async (cursor) => {
  const result = await hub.queryEvents({ body: { mode: 'list', from, to, tz: 'UTC', cursor } })
  if (!('items' in result)) throw new Error('expected an Event list')
  return result
})
```

### Types

The spec's schemas are exported as `Schemas` (`Schemas['SessionSummary']`, `Schemas['Filter']`, …), with `OperationInput<'listSessions'>` and `OperationOutput<'listSessions'>` for any operation. The raw `paths`, `operations` and `components` from openapi-typescript are exported too.

## What it covers

Every operation under `/api/v1` that answers JSON. OTLP ingest (`/v1/logs`, `/v1/metrics`, `/v1/traces`) is left to OpenTelemetry exporters, and `/api/v1/docs` and `/llms.txt` are pages for people and agents.

## Develop

The files in `src/generated/` are written by `scripts/generate.ts`; regenerating after a spec change is covered in [Changing the Query API spec](../../docs/development.md#changing-the-query-api-spec). `pnpm lint` builds and packs the package and checks the tarball with [publint](https://publint.dev) and [Are the Types Wrong?](https://arethetypeswrong.github.io) (`lint:package`). In the workspace the package exports its TypeScript source; `publishConfig.exports` points the published package at `dist/`.

The tests call every operation through the client against the real Hub on PGLite (`src/integration.test.ts`, with `testHub` from `@mitcsutt/embertrail-hub/testing`); a stand-in Hub (`test/mock-hub.ts`) covers the client's own transport behaviour.
