import type { Schemas } from '@mitcsutt/embertrail-client'

import { defaultLimit } from '#features/widgets/constants/queryOptions'
import type { QueryWidgetConfig } from '#features/widgets/types/queryWidget'
import type { WidgetKind } from '#features/widgets/types/widget'
import { chartAvailability } from '#features/widgets/utils/queryWidget'

type Filter = Schemas['Filter']

/** The configuration a new Query Widget starts from: cost, as one number. */
export function newQueryConfig(): QueryWidgetConfig {
  return {
    source: { kind: 'metric', name: '', aggregation: 'sum' },
    groupBy: [],
    filter: [],
    chart: 'stat',
    limit: defaultLimit,
  }
}

const preferred: WidgetKind[] = ['stat', 'series', 'bars', 'bar-list', 'share', 'heatmap', 'table']

/**
 * `config`, with the chart kind moved to the first one that can draw its rows when changing the
 * time bucket or the Group by keys took the current kind away. The table draws any rows.
 */
export function withDrawableChart(config: QueryWidgetConfig): QueryWidgetConfig {
  const availability = chartAvailability(config)
  if (availability[config.chart] === undefined) return config
  return { ...config, chart: preferred.find((kind) => availability[kind] === undefined) ?? 'table' }
}

const scalar = (text: string): string | number | boolean => {
  const trimmed = text.trim()
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  return trimmed !== '' && Number.isFinite(Number(trimmed)) ? Number(trimmed) : text
}

/**
 * A filter with this key, operator and value text. A number or `true`/`false` is matched as such,
 * anything else as text; the `in` operators split on commas.
 */
export function makeFilter(key: string, op: Filter['op'], text: string): Filter {
  switch (op) {
    case 'exists':
    case 'not_exists':
      return { key, op }
    case 'in':
    case 'not_in':
      return {
        key,
        op,
        value: text
          .split(',')
          .map((member) => member.trim())
          .filter((member) => member !== '')
          .map(scalar),
      }
    default:
      return { key, op, value: scalar(text) }
  }
}
