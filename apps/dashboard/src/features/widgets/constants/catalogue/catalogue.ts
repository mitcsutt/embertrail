import { costToday } from '#features/widgets/components/CostToday'
import { eachDayByModel } from '#features/widgets/components/EachDayByModel'
import { topSessions } from '#features/widgets/components/TopSessions'
import type { WidgetDefinition } from '#features/widgets/types/widget'
import { asCatalogueEntry } from '#features/widgets/utils/asCatalogueEntry'

/** Every Widget a Board can hold, in Catalogue order (grouped as #16 lists them). */
export const catalogue: readonly WidgetDefinition[] = [
  asCatalogueEntry(costToday),
  asCatalogueEntry(eachDayByModel),
  asCatalogueEntry(topSessions),
]

/** The Widget with this stable id, or `undefined` for one a Board names that no longer exists. */
export function getWidget(id: string): WidgetDefinition | undefined {
  return catalogue.find((widget) => widget.id === id)
}
