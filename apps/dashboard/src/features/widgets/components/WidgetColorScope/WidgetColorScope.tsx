import { ChartColorScope } from '@mitcsutt/kiln-charts'
import { useMemo, type ReactNode } from 'react'

import { chartColorOrder } from '#features/widgets/utils/chartColorOrder'

/**
 * One colour per model across every chart under it, whichever Widget draws first (a Board wraps
 * its grid in one).
 */
export function WidgetColorScope({
  models,
  children,
}: {
  models: readonly string[]
  children: ReactNode
}) {
  const order = useMemo(() => chartColorOrder({ models }), [models])
  return <ChartColorScope order={order}>{children}</ChartColorScope>
}
