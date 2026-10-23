/** A resolved time window: UTC instants, `from` inclusive and `to` exclusive, as the Query API reads them. */
export interface ResolvedWindow {
  from: string
  to: string
}

/** The fixed windows a Widget can declare besides following the Board (`WidgetDefinition.window`). */
export type FixedWindow = 'today' | 'this-week' | 'last-28-days' | 'last-12-weeks'
