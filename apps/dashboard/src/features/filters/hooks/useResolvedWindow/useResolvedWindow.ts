import { useMemo } from 'react'

import type { TimeRange } from '#features/filters/types/filters'
import type { ResolvedWindow } from '#features/filters/types/window'
import { resolveWindow } from '#features/filters/utils/resolveWindow'

/** `resolveWindow`, kept while its inputs are. */
export function useResolvedWindow(range: TimeRange, now: Date, tz: string): ResolvedWindow {
  return useMemo(() => resolveWindow(range, now, tz), [range, now, tz])
}
