import { presetIds } from '#features/boards/types/board'
import { presetBoard } from '#features/boards/utils/presets'
import { catalogue } from '#features/widgets/constants/catalogue'

const presets = presetIds.map((id) => ({
  id,
  name: presetBoard(id, catalogue).name,
}))

/** The Presets in navigation order (overview, everything, new), each named by its own document. */
export function usePresetList() {
  return presets
}
