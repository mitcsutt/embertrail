import type { presetIds } from '#features/boards/types/board'

type PresetId = (typeof presetIds)[number]

/** The Preset ids with the names the navigation shows, in the order it lists them. */
export const presetSummaries: readonly { id: PresetId; name: string }[] = [
  { id: 'overview', name: 'Overview' },
  { id: 'everything', name: 'Everything' },
  { id: 'new', name: 'New Board' },
]
