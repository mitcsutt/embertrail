import { otel } from '@mitcsutt/embertrail-otel'
import { store } from '@mitcsutt/embertrail-store'

/**
 * The Modules a Hub built from this repository loads, in dependency order. The server boots with
 * them and `embertrail migrate` migrates them, so the two agree.
 */
export const hubModules = [otel, store]
