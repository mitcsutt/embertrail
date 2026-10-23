// @vitest-environment node

// A Hub that only holds a sender that isn't Claude Code (#42): every Widget of the Catalogue finds
// nothing to show and reports itself empty, instead of drawing zeros.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { catalogue } from '#features/widgets/constants/catalogue'

import { dashboardTestHub } from './hub.ts'
import type { DashboardTestHub } from './hub.ts'
import { loadWidget, testContext } from './widget.ts'

let hub: DashboardTestHub
beforeAll(async () => {
  hub = await dashboardTestHub({ demo: { sender: 'other' } })
})
afterAll(async () => {
  await hub.close()
})

describe('on a Hub with only a non-Claude sender', () => {
  it.each(catalogue.map((widget) => [widget.title, widget] as const))(
    '%s is empty',
    async (_, widget) => {
      const { today } = (hub.demo ?? failed('demo')).facts
      const window = {
        from: new Date(Date.parse(today.from) - 40 * 86_400_000).toISOString(),
        to: today.to,
      }
      const data = await loadWidget(hub.client, widget, testContext(window))
      expect(widget.isEmpty(data)).toBe(true)
    },
  )
})

function failed(what: string): never {
  throw new Error(`${what} is missing`)
}
