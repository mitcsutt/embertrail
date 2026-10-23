import type { EmbertrailClient } from '@mitcsutt/embertrail-client'
import { use } from 'react'

import { WidgetClientContext } from '#features/widgets/stores/WidgetClientContext'

export function useWidgetClient(): EmbertrailClient {
  const client = use(WidgetClientContext)
  if (client === undefined) throw new Error('useWidgetClient needs a WidgetClientProvider')
  return client
}
