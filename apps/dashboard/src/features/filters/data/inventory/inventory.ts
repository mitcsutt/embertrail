import type { EmbertrailClient, Schemas } from '@mitcsutt/embertrail-client'
import { queryOptions, useQuery } from '@tanstack/react-query'

import type { ResolvedWindow } from '#features/filters/types/window'

export type Inventory = Schemas['Inventory']

/** What exists in the visible data in the window; it fills the filter pickers and labels ids. */
export function inventoryQueryOptions(client: EmbertrailClient, window: ResolvedWindow) {
  return queryOptions({
    queryKey: ['inventory', window.from, window.to],
    queryFn: ({ signal }) => client.getInventory({ query: window, signal }),
  })
}

/** The Inventory for a window. The caller passes the client: the Hub provider owns it (#72 D2). */
export function useInventory(client: EmbertrailClient, window: ResolvedWindow) {
  return useQuery(inventoryQueryOptions(client, window))
}
