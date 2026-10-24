import { TZDate } from '@date-fns/tz'
import { Sparkline } from '@mitcsutt/kiln-charts'
import { Stat, type StatDelta } from '@mitcsutt/kiln-ui'
import { addDays, addHours, startOfDay } from 'date-fns'

import type { QueryContext } from '#features/filters/types/filters'
import type { WidgetDefinition, WidgetGroup } from '#features/widgets/types/widget'
import { bucketedRows } from '#features/widgets/utils/aggregateRows'
import { chartBucket } from '#features/widgets/utils/chartBucket'
import { filterClause } from '#features/widgets/utils/filterClause'
import { formatPercent } from '#features/widgets/utils/formats'
import { previousWindow } from '#features/widgets/utils/previousWindow'

/** One bucket of the Board's window: its start (an ISO time with an offset) and its total. */
export interface PeriodPoint {
  at: string
  value: number
}

export interface PeriodStatData {
  /** The window's total; `null` when the Hub holds none of the Metric in either window. */
  total: number | null
  /** The total of the window of as many days before it; `null` when it holds none. */
  previous: number | null
  /** How many local days each window spans. */
  days: number
  /** The window bucket by bucket, a quiet bucket as zero, for the sparkline. */
  points: PeriodPoint[]
  bucket: 'hour' | 'day'
}

/** What one KPI is: a Metric summed over the Board's window, and how to write it. */
export interface PeriodStatSpec {
  id: string
  group: WidgetGroup
  title: string
  description: string
  metric: string
  /** The Board filters the Metric carries. */
  filters: WidgetDefinition['filters']
  /** Writes a total, such as `formatUsd`. A Metric in seconds converts here. */
  format: (value: number) => string
}

const at = (instant: string, tz: string) => new TZDate(Date.parse(instant), tz)

/**
 * Every bucket of the window up to `until`, in order, with the buckets the Hub left out (nothing
 * sent) as 0. A window still running stops at now: the hours to come are not quiet, just not here.
 */
function everyBucket(
  rows: readonly PeriodPoint[],
  ctx: Pick<QueryContext, 'from' | 'tz'>,
  until: string,
  bucket: 'hour' | 'day',
): PeriodPoint[] {
  const byStart = new Map(rows.map((row) => [Date.parse(row.at), row.value]))
  const step = bucket === 'hour' ? addHours : addDays
  const end = Date.parse(until)
  const points: PeriodPoint[] = []
  for (let start = at(ctx.from, ctx.tz); start.getTime() < end; start = step(start, 1)) {
    points.push({ at: start.toISOString(), value: byStart.get(start.getTime()) ?? 0 })
  }
  return points
}

/** The bucket the request asks for: the hour while the window runs, otherwise the chart's. */
const requestBucket = (ctx: Pick<QueryContext, 'from' | 'to' | 'tz' | 'now'>) =>
  previousWindow(ctx).until === ctx.to ? chartBucket(ctx) : 'hour'

/**
 * Splits one answer over both windows into the Board's window and the one before it. A bucket
 * belongs to the window it starts in. While the Board's window is still running, both are cut at
 * the same time into them, and the hours are folded into days for a window of days.
 */
export function selectPeriod(
  response: unknown,
  ctx: Pick<QueryContext, 'from' | 'to' | 'tz' | 'now'>,
): PeriodStatData {
  const bucket = chartBucket(ctx)
  const { days, until, previousUntil } = previousWindow(ctx)
  const start = Date.parse(ctx.from)
  const previousEnd = Date.parse(previousUntil)
  const folded = new Map<number, number>()
  let previous: number | null = null
  for (const row of bucketedRows(response)) {
    const time = Date.parse(row.bucket)
    if (time < start) {
      if (time < previousEnd) previous = (previous ?? 0) + row.value
    } else {
      const key = bucket === 'day' ? startOfDay(at(row.bucket, ctx.tz)).getTime() : time
      folded.set(key, (folded.get(key) ?? 0) + row.value)
    }
  }
  const current = [...folded].map(([time, value]) => ({
    at: new Date(time).toISOString(),
    value,
  }))
  const total =
    current.length > 0
      ? current.reduce((sum, point) => sum + point.value, 0)
      : previous === null
        ? null
        : 0
  return { total, previous, days, points: everyBucket(current, ctx, until, bucket), bucket }
}

/**
 * The change against the window before, as a percentage, or `undefined` when there is nothing to
 * compare with. Every KPI is neutral: more cost or more Sessions is not good or bad by itself.
 */
export function periodDelta({ total, previous }: PeriodStatData): StatDelta | undefined {
  if (total === null || previous === null || previous === 0) return undefined
  const change = (total - previous) / previous
  if (Math.abs(change) < 0.005) return { value: '0%', direction: 'flat', tone: 'neutral' }
  return {
    value: `${change > 0 ? '+' : '−'}${formatPercent(Math.abs(change))}`,
    direction: change > 0 ? 'up' : 'down',
    tone: 'neutral',
  }
}

const before = (days: number) => (days === 1 ? 'the day before' : `the ${String(days)} days before`)

/**
 * The line under the figure, kept to a few words so a row of six KPIs stays one line each: the
 * figure it is compared with. `periodComparison` says it in full, as the tooltip.
 */
export function periodHint(data: PeriodStatData, format: (value: number) => string): string {
  return data.previous === null ? 'Nothing before' : `vs ${format(data.previous)}`
}

/** What the change is measured against, in full. */
export function periodComparison(data: PeriodStatData, format: (value: number) => string): string {
  if (data.previous === null) return `Nothing in ${before(data.days)}`
  return `Against ${format(data.previous)} in ${before(data.days)}`
}

/**
 * A KPI over the Board's window: the total, its change against the window of as many days before
 * it, and a sparkline of the window. One request covers both windows.
 */
export function periodStat(spec: PeriodStatSpec): WidgetDefinition<PeriodStatData> {
  return {
    id: spec.id,
    group: spec.group,
    title: spec.title,
    description: spec.description,
    kind: 'stat',
    size: { w: 2, h: 3 },
    minSize: { w: 2, h: 3 },
    window: 'board',
    filters: spec.filters,
    request: (ctx) => ({
      op: 'queryMetrics',
      body: {
        metric: spec.metric,
        aggregation: 'sum',
        from: previousWindow(ctx).from,
        to: previousWindow(ctx).until,
        tz: ctx.tz,
        bucket: requestBucket(ctx),
        ...filterClause(ctx),
      },
    }),
    select: (response, ctx) => selectPeriod(response, ctx),
    isEmpty: ({ total }) => total === null,
    View: ({ data, ctx, label }) => (
      <div style={{ display: 'grid', alignContent: 'space-between', gap: 'var(--space-2)' }}>
        <Stat
          title={periodComparison(data, spec.format)}
          label={label}
          value={spec.format(data.total ?? 0)}
          delta={periodDelta(data)}
          hint={periodHint(data, spec.format)}
        />
        <Sparkline
          data={data.points.map((point) => ({ ...point }))}
          x="at"
          dataKey="value"
          label={`${label} by ${data.bucket}`}
          variant="area"
          height={28}
          format={spec.format}
          xFormat={data.bucket === 'hour' ? 'time' : 'date'}
          timeZone={ctx.tz}
        />
      </div>
    ),
  }
}
