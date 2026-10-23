import type { EmbertrailClient } from '@mitcsutt/embertrail-client'
import { createContext } from 'react'

/** The Hub client Widgets read through; `WidgetClientProvider` sets it. */
export const WidgetClientContext = createContext<EmbertrailClient | undefined>(undefined)
