import { Bars, BarList, Heatmap, Share, TimeSeries } from '@mitcsutt/kiln-charts'
import type { ValueFormat, XFormat } from '@mitcsutt/kiln-charts'
import { Stat, Table } from '@mitcsutt/kiln-ui'

import type { QueryData } from '#features/widgets/types/queryWidget'
import { formatUsd } from '#features/widgets/utils/formats'

const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const hours = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0'))

const isUsd = (unit: string | null) => unit?.toUpperCase() === 'USD'

const chartFormat = (unit: string | null): ValueFormat =>
  isUsd(unit) ? { style: 'currency', currency: 'USD' } : 'number'

const textFormat = (unit: string | null, value: number): string =>
  isUsd(unit) ? formatUsd(value) : value.toLocaleString()

const xFormat = (bucket: QueryData['bucket']): XFormat =>
  bucket === 'minute' || bucket === 'hour' ? 'datetime' : bucket === 'month' ? 'month' : 'date'

const cell = (value: string | number | boolean | null): string =>
  value === null ? '' : typeof value === 'number' ? value.toLocaleString() : String(value)

/** A Query Widget's rows drawn as the chart kind it was configured with. */
export function QueryWidgetView({
  data,
  label,
  tz,
}: {
  data: QueryData
  label: string
  tz: string
}) {
  const format = chartFormat(data.unit)
  switch (data.chart) {
    case 'stat':
      return <Stat label={label} size="lg" value={textFormat(data.unit, data.value ?? 0)} />
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
                      ? textFormat(data.unit, value)
                      : cell(value)}
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
