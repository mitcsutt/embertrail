import { cacheShare } from '#features/widgets/components/CacheShare'
import { costByAccount } from '#features/widgets/components/CostByAccount'
import { costThisWeek } from '#features/widgets/components/CostThisWeek'
import { costToday } from '#features/widgets/components/CostToday'
import { eachDayByModel } from '#features/widgets/components/EachDayByModel'
import { modelMix } from '#features/widgets/components/ModelMix'
import { sessionsPerDay } from '#features/widgets/components/SessionsPerDay'
import { sessionsToday } from '#features/widgets/components/SessionsToday'
import { tokensByType } from '#features/widgets/components/TokensByType'
import { topSessions } from '#features/widgets/components/TopSessions'
import { topTools } from '#features/widgets/components/TopTools'
import { toolFailures } from '#features/widgets/components/ToolFailures'
import { editAcceptance } from '#features/widgets/components/EditAcceptance'
import { linesChangedPerDay } from '#features/widgets/components/LinesChangedPerDay'
import { commitsPerDay } from '#features/widgets/components/CommitsPerDay'
import { todayByHourVsTypical } from '#features/widgets/components/TodayByHourVsTypical'
import { whenYouWork } from '#features/widgets/components/WhenYouWork'
import { activeTimePerDay } from '#features/widgets/components/ActiveTimePerDay'
import { apiErrors } from '#features/widgets/components/ApiErrors'
import { requestLatency } from '#features/widgets/components/RequestLatency'
import type { WidgetDefinition } from '#features/widgets/types/widget'
import { asCatalogueEntry } from '#features/widgets/utils/asCatalogueEntry'

/** Every Widget a Board can hold, in Catalogue order (grouped as #16 lists them). */
export const catalogue: readonly WidgetDefinition[] = [
  asCatalogueEntry(costToday),
  asCatalogueEntry(costThisWeek),
  asCatalogueEntry(eachDayByModel),
  asCatalogueEntry(costByAccount),
  asCatalogueEntry(sessionsToday),
  asCatalogueEntry(topSessions),
  asCatalogueEntry(sessionsPerDay),
  asCatalogueEntry(modelMix),
  asCatalogueEntry(cacheShare),
  asCatalogueEntry(tokensByType),
  asCatalogueEntry(topTools),
  asCatalogueEntry(toolFailures),
  asCatalogueEntry(editAcceptance),
  asCatalogueEntry(linesChangedPerDay),
  asCatalogueEntry(commitsPerDay),
  asCatalogueEntry(todayByHourVsTypical),
  asCatalogueEntry(whenYouWork),
  asCatalogueEntry(activeTimePerDay),
  asCatalogueEntry(apiErrors),
  asCatalogueEntry(requestLatency),
]

/** The Widget with this stable id, or `undefined` for one a Board names that no longer exists. */
export function getWidget(id: string): WidgetDefinition | undefined {
  return catalogue.find((widget) => widget.id === id)
}
