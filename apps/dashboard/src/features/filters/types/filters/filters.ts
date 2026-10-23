import type { Schemas } from '@mitcsutt/embertrail-client'

export type RelativeRange =
  'today' | 'yesterday' | 'this-week' | 'last-7-days' | 'last-30-days' | 'last-90-days'

/** Relative ranges are stored by name, so a saved Board stays current. */
export type TimeRange =
  { kind: 'relative'; range: RelativeRange } | { kind: 'absolute'; from: string; to: string }

export interface BoardFilters {
  time: TimeRange
  sourceId?: string
  accountId?: string
  model?: string
}

/** A Widget's own pinned filters, which win over the Board's. */
export type FilterOverride = Partial<BoardFilters>

/** What a Widget's request is built from: a resolved window, the zone, Query API filters and now. */
export interface QueryContext {
  from: string
  to: string
  /** An IANA zone. Never a fixed offset: the Hub returns 422 for one. */
  tz: string
  /** Already mapped, and only the filters this Widget honours. */
  filter: Schemas['Filter'][]
  now: Date
  /** The same filters in the shape `listSessions` takes. */
  sessions: { source_id?: string; account_id?: string; model?: string }
}
