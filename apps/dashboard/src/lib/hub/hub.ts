import { createClient, type EmbertrailClient, type Schemas } from '@mitcsutt/embertrail-client'
import { useQuery } from '@tanstack/react-query'
import { createContext, use } from 'react'

import type { RuntimeConfig } from '#config/runtimeConfig'

/** The configured client and where it points. */
export interface Hub {
  client: EmbertrailClient
  /** The configured base URL, `''` for the page's own origin. Keys every Hub query. */
  hubUrl: string
  /** The address to show a person: the Hub's URL, or this page's origin when `hubUrl` is empty. */
  display: string
}

/** The one client for the app, from `config.json`. Only data modules call it. */
export function createHub(config: RuntimeConfig, origin = globalThis.location.origin): Hub {
  return {
    client: createClient({
      baseUrl: config.hubUrl,
      ...(config.headers === undefined ? {} : { headers: config.headers }),
    }),
    hubUrl: config.hubUrl,
    display: config.hubUrl === '' ? origin : config.hubUrl,
  }
}

export const HubContext = createContext<Hub | undefined>(undefined)

export function useHub(): Hub {
  const hub = use(HubContext)
  if (hub === undefined) throw new Error('useHub needs a HubProvider')
  return hub
}

/**
 * Who the Hub says is calling. A Hub without `getSelf`, or a Token it refuses, leaves `self`
 * undefined and `canEdit` true: the write itself reports a missing Scope.
 */
export function useSelf(): {
  self: Schemas['Self'] | undefined
  canEdit: boolean
  pending: boolean
} {
  const { client, hubUrl } = useHub()
  const { data, isPending } = useQuery({
    queryKey: ['hub', hubUrl, 'getSelf'],
    queryFn: ({ signal }) => client.getSelf({ signal }),
    retry: false,
    staleTime: Infinity,
  })
  return {
    self: data,
    canEdit: data === undefined || data.scopes.includes('store:write'),
    pending: isPending,
  }
}
