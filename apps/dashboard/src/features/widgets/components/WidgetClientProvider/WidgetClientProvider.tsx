import type { EmbertrailClient } from '@mitcsutt/embertrail-client'
import type { ReactNode } from 'react'

import { WidgetClientContext } from '#features/widgets/stores/WidgetClientContext'

/**
 * Gives Widgets the Hub client. The app mounts it once with the client built from the runtime
 * config; tests mount it with a client on a test Hub.
 */
export function WidgetClientProvider({
  client,
  children,
}: {
  client: EmbertrailClient
  children: ReactNode
}) {
  return <WidgetClientContext value={client}>{children}</WidgetClientContext>
}
