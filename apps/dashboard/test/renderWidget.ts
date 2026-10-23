// Renders a Catalogue Widget through the same `Widget` wrapper the Board uses, from a stub client
// that answers every metrics and events query with the rows given. For a Widget's View test: what
// the numbers should be is tested against the demo Hub; this is that the View shows what its data
// says. kiln-charts is never laid out in jsdom, so a chart is read from its data table.

import type { EmbertrailClient } from '@mitcsutt/embertrail-client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { createElement } from 'react'
import { vi } from 'vitest'

import type { QueryContext } from '#features/filters/types/filters'
import { Widget } from '#features/widgets/components/Widget'
import { getWidget } from '#features/widgets/constants/catalogue'
import { HubContext } from '#lib/hub'

/** A week in Berlin ending on the morning of Wednesday 4 November 2026, 09:30 local. */
export const viewContext: QueryContext = {
  from: '2026-10-28T00:00:00+01:00',
  to: '2026-11-05T00:00:00+01:00',
  tz: 'Europe/Berlin',
  filter: [],
  now: new Date('2026-11-04T09:30:00+01:00'),
  sessions: {},
}

export interface StubRow {
  bucket?: string
  group: Record<string, unknown>
  value: number
}

/** Renders the Widget with this id; resolves to the stub that answered, to assert on its calls. */
export function renderWidget(id: string, rows: StubRow[]) {
  const answer = vi.fn().mockResolvedValue({ rows, meta: {} })
  const client = { queryMetrics: answer, queryEvents: answer } as unknown as EmbertrailClient
  const definition = getWidget(id)
  if (definition === undefined) throw new Error(`${id} is not in the Catalogue`)
  render(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(
        HubContext,
        { value: { client, hubUrl: '', display: 'http://localhost' } },
        createElement(Widget, { definition, ctx: viewContext }),
      ),
    ),
  )
  return answer
}
