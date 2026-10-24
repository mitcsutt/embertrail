import { ProblemError } from '@mitcsutt/embertrail-client'
import type { EmbertrailClient } from '@mitcsutt/embertrail-client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { BoardFilters } from '#features/filters/types/filters'
import type { QueryWidgetConfig } from '#features/widgets/types/queryWidget'
import { HubContext } from '#lib/hub'

import { QueryWidget } from './QueryWidget'

const filters: BoardFilters = { time: { kind: 'relative', range: 'last-7-days' } }
const now = new Date('2026-11-04T09:30:00+01:00')

function renderQuery(
  config: QueryWidgetConfig,
  answer: ReturnType<typeof vi.fn>,
  boardFilters: BoardFilters = filters,
) {
  const client = { queryMetrics: answer, queryEvents: answer } as unknown as EmbertrailClient
  render(
    <QueryClientProvider client={new QueryClient()}>
      <HubContext value={{ client, hubUrl: '', display: 'http://localhost' }}>
        <QueryWidget
          title="My query"
          config={config}
          filters={boardFilters}
          now={now}
          tz="Europe/Berlin"
        />
      </HubContext>
    </QueryClientProvider>,
  )
}

const rows = (...entries: [Record<string, unknown>, number, string?][]) =>
  vi.fn().mockResolvedValue({
    rows: entries.map(([group, value, bucket]) => ({
      group,
      value,
      ...(bucket !== undefined && { bucket }),
    })),
    meta: { tz: 'Europe/Berlin', unit: 'USD' },
  })

const cost: QueryWidgetConfig = {
  source: { kind: 'metric', name: 'claude_code.cost.usage', aggregation: 'sum' },
  groupBy: [],
  filter: [],
  chart: 'stat',
}

describe('QueryWidget', () => {
  it('draws a stat from the one row, in the Metric’s unit', async () => {
    renderQuery(cost, rows([{}, 12.5]))
    expect(await screen.findByText(/12\.50/)).toBeInTheDocument()
  })

  it('sends the request the configuration builds, with the Board’s filters', async () => {
    const answer = rows([{}, 1])
    renderQuery(cost, answer, { ...filters, sourceId: 'laptop' })
    await screen.findByText(/1\.00/)
    expect(answer).toHaveBeenCalledTimes(1)
    const [[request]] = answer.mock.calls as [[{ body: unknown }]]
    expect(request.body).toMatchObject({
      metric: 'claude_code.cost.usage',
      aggregation: 'sum',
      tz: 'Europe/Berlin',
      filter: [{ key: 'embertrail.source_id', op: 'eq', value: 'laptop' }],
    })
  })

  it('draws a table: a column per Group by key, then the value', async () => {
    renderQuery(
      { ...cost, groupBy: ['model', 'type'], chart: 'table' },
      rows([{ model: 'opus', type: 'input' }, 3], [{ model: 'sonnet', type: null }, 4]),
    )
    const table = await screen.findByRole('table')
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['model', 'type', 'Value'])
    const [, ...body] = within(table).getAllByRole('row')
    expect(body.map((row) => row.textContent)).toEqual([
      expect.stringMatching(/^opusinput.*3\.00$/),
      expect.stringMatching(/^sonnet.*4\.00$/),
    ])
  })

  it('draws a ranking from the group labels', async () => {
    renderQuery(
      { ...cost, groupBy: ['tool_name'], chart: 'bar-list' },
      rows([{ tool_name: 'Edit' }, 7], [{ tool_name: 'Bash' }, 5]),
    )
    expect(await screen.findByText('Edit')).toBeInTheDocument()
    expect(screen.getByText('Bash')).toBeInTheDocument()
  })

  it('draws bars over time from the buckets', async () => {
    renderQuery(
      { ...cost, bucket: 'day', groupBy: ['model'], chart: 'bars' },
      rows(
        [{ model: 'opus' }, 1, '2026-11-03T00:00:00+01:00'],
        [{ model: 'sonnet' }, 2, '2026-11-03T00:00:00+01:00'],
      ),
    )
    const table = await screen.findByRole('table')
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toContain('opus')
  })

  it('is empty when the Hub holds nothing for it', async () => {
    renderQuery(
      cost,
      vi.fn().mockResolvedValue({ rows: [], meta: { tz: 'Europe/Berlin', unit: null } }),
    )
    expect(await screen.findByText('Nothing recorded in this period')).toBeInTheDocument()
  })

  it('shows the Hub’s detail when it refuses the query (too-many-rows)', async () => {
    const detail = 'The query matches more than 10,000 rows; add a limit or a filter.'
    renderQuery(
      cost,
      vi.fn().mockRejectedValue(
        new ProblemError({
          type: 'urn:embertrail:problem:too-many-rows',
          title: 'Too many rows',
          status: 422,
          detail,
          request_id: 'req-1',
        }),
      ),
    )
    expect(await screen.findByText(detail)).toBeInTheDocument()
  })

  it('does not ask the Hub for a configuration it would refuse, and says why', async () => {
    const answer = rows([{}, 1])
    renderQuery({ ...cost, chart: 'series' }, answer)
    expect(await screen.findByText('A line needs a time bucket.')).toBeInTheDocument()
    expect(answer).not.toHaveBeenCalled()
  })
})
