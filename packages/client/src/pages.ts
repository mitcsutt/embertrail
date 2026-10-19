/** A cursor page, as every list in the Query API returns it. */
export interface Page<T> {
  items: T[]
  next_cursor: string | null
}

/**
 * Fetches page after page until `next_cursor` is `null`. `fetchPage` gets
 * `undefined` for the first page, then each page's `next_cursor`; pass it on
 * as the operation's `cursor` with the same query, since cursors are only
 * valid for the query that produced them.
 */
export async function* pages<P extends { next_cursor: string | null }>(
  fetchPage: (cursor: string | undefined) => Promise<P>,
): AsyncGenerator<P, void, undefined> {
  let cursor: string | undefined
  do {
    const page = await fetchPage(cursor)
    yield page
    cursor = page.next_cursor ?? undefined
  } while (cursor !== undefined)
}

/** Like {@link pages}, but yields each page's items one by one. */
export async function* items<T>(
  fetchPage: (cursor: string | undefined) => Promise<Page<T>>,
): AsyncGenerator<T, void, undefined> {
  for await (const page of pages(fetchPage)) yield* page.items
}
