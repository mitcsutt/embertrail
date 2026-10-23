import type { BoardDocument, BoardItem, BoardLayoutItem } from '#features/boards/types/board'
import { presetIds } from '#features/boards/types/board'
import type { WidgetGroup } from '#features/widgets/types/widget'

/** What a Preset needs to know about a Widget; `WidgetDefinition` satisfies it. */
export interface PresetWidget {
  id: string
  group: WidgetGroup
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
  title: string
  widgets: { id: string; w: number; h: number }[]
}

const slug = (title: string): string => title.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')

/**
 * Lays sections out top to bottom: a full-width static heading, then its Widgets left to right,
 * wrapping at column 12, each row as tall as its tallest Widget.
 */
function arrange(sections: Section[]): Pick<BoardDocument, 'items' | 'layout'> {
  const items: BoardItem[] = []
  const layout: BoardLayoutItem[] = []
  let y = 0
  for (const section of sections) {
    const i = `section-${slug(section.title)}`
    items.push({ i, type: 'section', title: section.title })
    layout.push({ i, x: 0, y, w: 12, h: 1, static: true })
    y += 1
    let x = 0
    let rowHeight = 0
    for (const { id, w, h } of section.widgets) {
      if (x + w > 12) {
        y += rowHeight
        x = 0
        rowHeight = 0
      }
      items.push({ i: id, type: 'widget', widget: id })
      layout.push({ i: id, x, y, w, h })
      x += w
      rowHeight = Math.max(rowHeight, h)
    }
    y += rowHeight
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

/** The Overview of #16: today first, then the period, then patterns. Frozen: customise a copy. */
export const overviewPreset: BoardDocument = deepFreeze({
  schema_version: 1,
  name: 'Overview',
  filters,
  ...arrange([
    {
      title: 'Today at a glance',
      widgets: [
        { id: 'cost-today', w: 3, h: 2 },
        { id: 'cost-this-week', w: 3, h: 2 },
        { id: 'sessions-today', w: 3, h: 2 },
        { id: 'cache-share', w: 3, h: 2 },
      ],
    },
    {
      title: 'Today',
      widgets: [
        { id: 'today-by-hour-vs-typical', w: 8, h: 4 },
        { id: 'model-mix', w: 4, h: 4 },
      ],
    },
    { title: 'This period', widgets: [{ id: 'each-day-by-model', w: 12, h: 4 }] },
    {
      title: 'Patterns',
      widgets: [
        { id: 'top-sessions', w: 7, h: 5 },
        { id: 'when-you-work', w: 5, h: 5 },
      ],
    },
  ]),
})

/** An empty Board to build from. Frozen: customise a copy. */
export const newBoardPreset: BoardDocument = deepFreeze({
  schema_version: 1,
  name: 'New Board',
  filters,
  items: [],
  layout: [],
})

/**
 * Every Widget of the Catalogue, one section per group in Catalogue order, each Widget at its
 * default size. Built from the Catalogue so a new Widget joins it without touching this file.
 */
export function everythingPreset(widgets: readonly PresetWidget[]): BoardDocument {
  const groups = new Map<WidgetGroup, Section>()
  for (const { id, group, size } of widgets) {
    let section = groups.get(group)
    if (section === undefined) {
      section = { title: groupTitles[group], widgets: [] }
      groups.set(group, section)
    }
    section.widgets.push({ id, ...size })
  }
  return deepFreeze({
    schema_version: 1,
    name: 'Everything',
    filters,
    ...arrange([...groups.values()]),
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
