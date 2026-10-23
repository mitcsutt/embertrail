import type { ReactNode } from 'react'

import { HubContext, type Hub } from '#lib/hub'

export function HubProvider({ hub, children }: { hub: Hub; children: ReactNode }) {
  return <HubContext value={hub}>{children}</HubContext>
}
