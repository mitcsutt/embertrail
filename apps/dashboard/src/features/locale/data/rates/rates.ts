import type { Schemas } from '@mitcsutt/embertrail-client'
import { useQuery } from '@tanstack/react-query'

import { useHub } from '#lib/hub'

export type Rates = Schemas['Rates']

/**
 * The Hub's daily exchange rates. They change once a working day, so a session keeps one copy
 * for an hour; a Hub that cannot answer leaves the Dashboard on USD, so one retry is enough.
 */
export function useRates() {
  const { client } = useHub()
  return useQuery({
    queryKey: ['rates'],
    queryFn: ({ signal }) => client.getRates({ signal }),
    staleTime: 3_600_000,
    retry: 1,
  })
}
