import { isProblemError } from '@mitcsutt/embertrail-client'
import type { ChartStatus } from '@mitcsutt/kiln-charts'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import type { QueryContext } from '#features/filters/types/filters'
import { runRequest } from '#features/widgets/data/runRequest'
import { useWidgetClient } from '#features/widgets/hooks/useWidgetClient'
import type { WidgetDefinition } from '#features/widgets/types/widget'

export interface WidgetData<Data> {
  status: ChartStatus
  data: Data | undefined
  error: unknown
  refetch: () => void
}

/**
 * Runs a Widget's request and selects its data. The query is keyed on the exact request, so a
 * filter change that leaves it unchanged (a Widget's pinned filter, say) neither refetches nor
 * resets it (#72 A2). This is the only path from a Widget to the Hub.
 */
export function useWidgetData<Data>(
  definition: WidgetDefinition<Data>,
  ctx: QueryContext,
): WidgetData<Data> {
  const client = useWidgetClient()
  const request = definition.request(ctx)
  const query = useQuery({
    queryKey: ['widget', request],
    queryFn: ({ signal }) => runRequest(client, request, signal),
    // A rejected request will be rejected again; a network failure may not be.
    retry: (count, error) => !isProblemError(error) && count < 1,
  })

  const data = useMemo(
    () => (query.data === undefined ? undefined : definition.select(query.data, ctx)),
    // The response is what changes; a new ctx object with the same request selects the same data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query.data, definition],
  )

  const status: ChartStatus = query.isError
    ? 'error'
    : data === undefined
      ? 'loading'
      : definition.isEmpty(data)
        ? 'empty'
        : 'ready'
  return {
    status,
    data,
    error: query.error,
    refetch: () => {
      void query.refetch()
    },
  }
}
