import { isProblemError } from '@mitcsutt/embertrail-client'
import type { ChartStatus } from '@mitcsutt/kiln-charts'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { inventoryQueryOptions } from '#features/filters/data/inventory'
import type { Inventory } from '#features/filters/data/inventory'
import type { QueryContext } from '#features/filters/types/filters'
import { runRequest } from '#features/widgets/data/runRequest'
import type { WidgetDefinition } from '#features/widgets/types/widget'
import { useHub } from '#lib/hub'

export interface WidgetData<Data> {
  status: ChartStatus
  data: Data | undefined
  /** The window's Inventory, for a Widget that asks for it (`inventory: true`). */
  inventory: Inventory | undefined
  error: unknown
  refetch: () => void
}

/**
 * Runs a Widget's request and selects its data. The query is keyed on the exact request, so a
 * filter change that leaves it unchanged (a Widget's pinned filter, say) neither refetches nor
 * resets it (#72 A2). This is the only path from a Widget to the Hub.
 *
 * A Widget that names things by the Inventory (`inventory: true`) also gets it, from the query the
 * filter bar already runs for the same window, so it costs no extra request on a Board. It stays
 * loading until the Inventory answers; if that fails the Widget still draws, with ids for names.
 */
export function useWidgetData<Data>(
  definition: WidgetDefinition<Data>,
  ctx: QueryContext,
): WidgetData<Data> {
  const { client } = useHub()
  const request = definition.request(ctx)
  const query = useQuery({
    queryKey: ['widget', request],
    queryFn: ({ signal }) => runRequest(client, request, signal),
    // A 4xx rejection will be rejected again; a network failure or a 5xx may not be.
    retry: (count, error) => !(isProblemError(error) && error.status < 500) && count < 1,
  })

  const wantsInventory = definition.inventory === true
  const inventory = useQuery({
    ...inventoryQueryOptions(client, { from: ctx.from, to: ctx.to }),
    enabled: wantsInventory,
  })

  const data = useMemo(
    () => (query.data === undefined ? undefined : definition.select(query.data, ctx)),
    // The response is what changes; a new ctx object with the same request selects the same data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query.data, definition],
  )

  const status: ChartStatus = query.isError
    ? 'error'
    : data === undefined || (wantsInventory && inventory.isPending)
      ? 'loading'
      : definition.isEmpty(data)
        ? 'empty'
        : 'ready'
  return {
    status,
    data,
    inventory: wantsInventory ? inventory.data : undefined,
    error: query.error,
    refetch: () => {
      void query.refetch()
    },
  }
}
