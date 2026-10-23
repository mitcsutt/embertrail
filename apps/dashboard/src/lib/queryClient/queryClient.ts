import { QueryClient } from '@tanstack/react-query'

/** One QueryClient for the app. Widgets key their queries on the request they send (#72 A2). */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 60_000, refetchOnWindowFocus: false },
    },
  })
}
