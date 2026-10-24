import { Bars, BarList, Heatmap, Share, TimeSeries } from '@mitcsutt/kiln-charts'
import type { ValueFormat, XFormat } from '@mitcsutt/kiln-charts'
import { Stat, Table } from '@mitcsutt/kiln-ui'

import type { QueryData } from '#features/widgets/types/queryWidget'
import { useLocale } from '#features/locale/hooks/useLocale'
import { useMoney } from '#features/locale/hooks/useMoney'
import type { Money } from '#features/locale/hooks/useMoney'

const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const hours = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0'))

const isUsd = (unit: string | null) => unit?.toUpperCase() === 'USD'

const chartFormat = (unit: string | null, money: Money): ValueFormat =>
  isUsd(unit) ? money.plain : 'number'

const textFormat = (unit: string | null, value: number, money: Money, locale: string): string =>
  isUsd(unit) ? money.format(value) : value.toLocaleString(locale)

/** A chart's data with USD amounts in the currency on screen; other units are left as they are. */
function scaled(data: QueryData, money: Money): QueryData {
  if (!isUsd(data.unit)) return data
  switch (data.chart) {
    case 'series':
    case 'bars':
      return { ...data, points: data.points.map((p) => ({ ...p, value: money.scale(p.value) })) }
    case 'bar-list':
    case 'share':
      return { ...data, items: data.items.map((i) => ({ ...i, value: money.scale(i.value) })) }
    case 'heatmap':
      return { ...data, cells: data.cells.map((row) => row.map((v) => money.scale(v))) }
    case 'stat':
    case 'table':
      return data
  }
}

const xFormat = (bucket: QueryData['bucket']): XFormat =>
  bucket === 'minute' || bucket === 'hour' ? 'datetime' : bucket === 'month' ? 'month' : 'date'

const cell = (value: string | number | boolean | null, locale: string): string =>
  value === null ? '' : typeof value === 'number' ? value.toLocaleString(locale) : String(value)

/** A Query Widget's rows drawn as the chart kind it was configured with. */
export function QueryWidgetView({
  data: raw,
  label,
  tz,
}: {
  data: QueryData
  label: string
  tz: string
}) {
  const money = useMoney()
  const { locale } = useLocale()
  const data = scaled(raw, money)
  const format = chartFormat(data.unit, money)
  switch (data.chart) {
    case 'stat':
      return (
        <Stat
          label={label}
          size="lg"
          value={textFormat(data.unit, data.value ?? 0, money, locale)}
        />
      )
    case 'series':
      return (
        <TimeSeries
          data={data.points.map((point) => ({ ...point }))}
          x="x"
          label={label}
          height="fill"
          pivot={{ by: 'series', value: 'value' }}
          format={format}
          xFormat={xFormat(data.bucket)}
          timeZone={tz}
        />
      )
    case 'bars':
      return data.bucket === undefined ? (
        <Bars
          data={data.points.map((point) => ({ ...point }))}
          x="x"
          label={label}
          height="fill"
          pivot={{ by: 'series', value: 'value' }}
          stacked
          format={format}
        />
      ) : (
        <Bars
          data={data.points.map((point) => ({ ...point }))}
          x="x"
          label={label}
          height="fill"
          pivot={{ by: 'series', value: 'value' }}
          stacked
          format={format}
          xFormat={xFormat(data.bucket)}
          timeZone={tz}
        />
      )
    case 'bar-list':
      return (
        <BarList
          data={data.items.map((item) => ({ ...item }))}
          pivot={{ by: 'label', value: 'value' }}
          label={label}
          format={format}
          max={10}
        />
      )
    case 'share':
      return (
        <Share
          data={data.items.map((item) => ({ ...item }))}
          pivot={{ by: 'label', value: 'value' }}
          label={label}
          format={format}
          totalLabel="total"
        />
      )
    case 'table':
      return (
        <Table label={label} density="compact">
          <Table.Head>
            <Table.Row>
              {data.columns.map((column, index) => (
                <Table.HeaderCell key={column} numeric={index === data.columns.length - 1}>
                  {column}
                </Table.HeaderCell>
              ))}
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {data.rows.map((row, rowIndex) => (
              // Rows have no identity of their own; they are replaced whole.
              <Table.Row key={rowIndex}>
                {row.map((value, index) => (
                  <Table.Cell
                    key={data.columns[index]}
                    rowHeader={index === 0 && data.columns.length > 1}
                    numeric={index === row.length - 1}
                  >
                    {index === row.length - 1 && typeof value === 'number'
                      ? textFormat(data.unit, value, money, locale)
                      : cell(value, locale)}
                  </Table.Cell>
                ))}
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )
    case 'heatmap':
      return (
        <Heatmap
          data={data.cells.map((cells, day) => {
            const row: Record<string, string | number> = { day: weekdays[day] ?? '' }
            for (const [hour, value] of cells.entries()) row[hours[hour] ?? ''] = value
            return row
          })}
          x="day"
          columns={hours}
          label={label}
          format={format}
        />
      )
  }
}
