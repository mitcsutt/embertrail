import type { BoardDocument, BoardItem, BoardLayoutItem } from '#features/boards/types/board'
import { presetIds } from '#features/boards/types/board'
import { layoutColumns } from '#features/boards/schemas/board'
import { fillRow, intoRows } from '#features/boards/utils/reflow'
import type { WidgetGroup, WidgetKind } from '#features/widgets/types/widget'

/** What a Preset needs to know about a Widget; `WidgetDefinition` satisfies it. */
export interface PresetWidget {
  id: string
  group: WidgetGroup
  kind: WidgetKind
  size: { w: number; h: number }
}

export type PresetId = (typeof presetIds)[number]

export const isPresetId = (id: string): id is PresetId =>
  (presetIds as readonly string[]).includes(id)

/** The heading of each Widget group on the Everything Preset. */
export const groupTitles: Record<WidgetGroup, string> = {
  spend: 'Spend',
  sessions: 'Sessions',
  models: 'Models',
  tools: 'Tools',
  output: 'Output',
  rhythm: 'Rhythm',
  reliability: 'Reliability',
}

interface Section {
  /** The heading; a section without one only starts a new row. */
  title?: string
  widgets: { id: string; w: number; h: number }[]
}

const slug = (title: string): string => title.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')

type Placed = Section['widgets'][number]

/**
 * Lays sections out top to bottom: a full-width static heading (when the section has a title), then
 * its Widgets in rows that wrap at column 12, each row filled to the full width (`fillRow`).
 */
function arrange(sections: Section[]): Pick<BoardDocument, 'items' | 'layout'> {
  const items: BoardItem[] = []
  const layout: BoardLayoutItem[] = []
  let y = 0
  for (const section of sections) {
    if (section.title !== undefined) {
      const i = `section-${slug(section.title)}`
      items.push({ i, type: 'section', title: section.title })
      layout.push({ i, x: 0, y, w: layoutColumns, h: 1, static: true })
      y += 1
    }
    for (const row of intoRows(section.widgets, layoutColumns)) {
      let x = 0
      const filled = fillRow(row)
      for (const { id, w, h } of filled) {
        items.push({ i: id, type: 'widget', widget: id })
        layout.push({ i: id, x, y, w, h })
        x += w
      }
      y += filled[0]?.h ?? 0
    }
  }
  return { items, layout }
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const inner of Object.values(value)) deepFreeze(inner)
    Object.freeze(value)
  }
  return value
}

const filters: BoardDocument['filters'] = { time: { kind: 'relative', range: 'last-7-days' } }

/**
 * The Overview answers what happened, what it cost and what changed, above the fold: a row of KPIs
 * over the Board's window, each against the window before it with a sparkline; then the cost by day
 * beside the model mix; then where it went (the costliest Sessions, the tools) and the rhythm (today
 * against a typical day, when you work). Card titles name each Widget, so there are no section
 * headings to scroll past. Frozen: customise a copy.
 */
export const overviewPreset: BoardDocument = deepFreeze({
  schema_version: 2,
  name: 'Overview',
  filters,
  ...arrange([
    {
      widgets: [
        { id: 'period-cost', w: 2, h: 3 },
        { id: 'period-sessions', w: 2, h: 3 },
        { id: 'period-tokens', w: 2, h: 3 },
        { id: 'period-active-time', w: 2, h: 3 },
        { id: 'period-lines-changed', w: 2, h: 3 },
        { id: 'period-commits', w: 2, h: 3 },
      ],
    },
    {
      widgets: [
        { id: 'each-day-by-model', w: 8, h: 6 },
        { id: 'model-mix', w: 4, h: 6 },
      ],
    },
    {
      widgets: [
        { id: 'top-sessions', w: 7, h: 6 },
        { id: 'top-tools', w: 5, h: 6 },
      ],
    },
    {
      widgets: [
        { id: 'today-by-hour-vs-typical', w: 6, h: 6 },
        { id: 'when-you-work', w: 6, h: 6 },
      ],
    },
  ]),
})

/** An empty Board to build from. Frozen: customise a copy. */
export const newBoardPreset: BoardDocument = deepFreeze({
  schema_version: 2,
  name: 'New Board',
  filters,
  items: [],
  layout: [],
})

/**
 * Every Widget of the Catalogue, one section per group in Catalogue order: the group's stats in a
 * row of their own, then its charts and tables, each row filled to the full width. Built from the
 * Catalogue so a new Widget joins it without touching this file.
 */
export function everythingPreset(widgets: readonly PresetWidget[]): BoardDocument {
  const groups = new Map<WidgetGroup, { stats: Placed[]; rest: Placed[] }>()
  for (const { id, group, kind, size } of widgets) {
    let found = groups.get(group)
    if (found === undefined) {
      found = { stats: [], rest: [] }
      groups.set(group, found)
    }
    ;(kind === 'stat' ? found.stats : found.rest).push({ id, ...size })
  }
  const sections = [...groups].flatMap(([group, { stats, rest }]): Section[] => {
    const title = groupTitles[group]
    if (stats.length === 0) return [{ title, widgets: rest }]
    return rest.length === 0
      ? [{ title, widgets: stats }]
      : [{ title, widgets: stats }, { widgets: rest }]
  })
  return deepFreeze({
    schema_version: 2,
    name: 'Everything',
    filters,
    ...arrange(sections),
  })
}

/** The Preset behind a reserved id. */
export function presetBoard(id: PresetId, widgets: readonly PresetWidget[]): BoardDocument {
  switch (id) {
    case 'overview':
      return overviewPreset
    case 'everything':
      return everythingPreset(widgets)
    case 'new':
      return newBoardPreset
  }
}

/**
 * A Preset is read-only. Customising it starts a Board of the same Widgets under a new name: the
 * Preset's with " (copy)", except for the empty one, which is already a name for a new Board.
 */
export function customisePreset(preset: BoardDocument): BoardDocument {
  const name = preset.items.length === 0 ? preset.name : `${preset.name} (copy)`
  return { ...structuredClone(preset), name }
}
