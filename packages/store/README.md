# @mitcsutt/embertrail-store

The `store` Module (#35): namespaced JSON documents that apps keep on the Hub. The Dashboard uses the namespace `embertrail-dashboard`. The Hub knows nothing about what a document means.

It is written only against the Module contract ([`docs/writing-a-module.md`](../../docs/writing-a-module.md)). The core handles auth, Scopes, ownership, row-level security, OpenAPI, export and delete-by-Owner; the Module declares no raw ops, Scope overrides or exporter.

## Routes

The Scopes are `store:read` and `store:write`. The contract is in [`spec/query-api.yaml`](../../spec/query-api.yaml).

| Route                                   | Answers                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------ |
| `GET /api/v1/store/{namespace}`         | The documents the caller can read, most recently updated first; `cursor` and `limit` |
| `GET /api/v1/store/{namespace}/{id}`    | One document, with an `ETag`                                                         |
| `PUT /api/v1/store/{namespace}/{id}`    | 201 created or 200 replaced, with an `ETag`; the body is `{ "data": <any JSON> }`    |
| `DELETE /api/v1/store/{namespace}/{id}` | 204; a hard delete                                                                   |

## Behaviour worth knowing

- **Ids are unique per namespace across every Owner.** If a document the caller can't see already holds the id, `PUT` answers 409 `conflict` and reveals nothing else about it. `GET` and `DELETE` answer 404, as they do for any id the caller can't see.
- **ETags are strong** and built from the creation time plus the `version`. A document that is deleted and created again under the same id gets a new ETag, so a stale `If-Match` can't overwrite it.
- **Conditional requests.** `If-Match` (a list, or `*`) on `PUT` and `DELETE` acts only when a tag matches, and answers 412 otherwise. On `PUT` that includes an id with no document, while `DELETE` answers 404 for one. `If-None-Match: *` on `PUT` creates only, and answers 412 when the id exists. Weak tags never match.
- **Size.** `data` may be at most 1 MiB (1,048,576 bytes) of serialised UTF-8 JSON. Anything larger answers 413 `payload-too-large`.
- **Cursors** are opaque, tied to their namespace, and keyed on `(updated_at, id)`. A cursor this namespace didn't issue answers 400 `invalid-cursor`.
- **Owner.** A new document belongs to the caller's Owner, which the database stamps, and a replace keeps the Owner. `owner.kind` comes from `ctx.ownerOf`.

## Not built yet: Team documents

Core identity (#29) now provides Teams with member and editor roles, `Embertrail-Owner: team:<id>`, and row-level security that lets members read and editors write ([`docs/identity.md`](../../docs/identity.md)). The store doesn't accept Team documents yet. The core answers 403 to `Embertrail-Owner` from anyone who isn't an editor of that Team. When an editor sends it on `PUT`, the store answers 422 and writes nothing, so the document never quietly becomes a personal one. If row-level security lets a caller read a document but not write it, `PUT` and `DELETE` already answer 403. The Team tests are `it.todo` in `src/store.test.ts`.
