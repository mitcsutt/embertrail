import type { Schemas } from '@mitcsutt/embertrail-client'
import {
  Alert,
  Button,
  ComboboxField,
  Inline,
  NumberField,
  SelectField,
  Sheet,
  Stack,
  Text,
  TextField,
} from '@mitcsutt/kiln-ui'
import type { ComboboxOption } from '@mitcsutt/kiln-ui'
import { useState } from 'react'

import type { Inventory } from '#features/filters/data/inventory'
import {
  comparisonOps,
  eventAggregations,
  maxGroupBy,
  maxLimit,
  maxQueryFilters,
  membershipOps,
  metricAggregations,
  presenceOps,
  queryBuckets,
} from '#features/widgets/constants/queryOptions'
import type { QueryIssue, QueryWidgetConfig } from '#features/widgets/types/queryWidget'
import type { WidgetKind } from '#features/widgets/types/widget'
import { makeFilter, newQueryConfig, withDrawableChart } from '#features/widgets/utils/queryDraft'
import { chartAvailability, validateQueryConfig } from '#features/widgets/utils/queryWidget'

type Filter = Schemas['Filter']

export interface QueryWidgetValue {
  title: string
  query: QueryWidgetConfig
}

export interface QueryWidgetEditorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** What the pickers offer; the editor still works, with typed names, while it loads. */
  inventory: Inventory | undefined
  onSave: (value: QueryWidgetValue) => void
  /** Where focus goes when the sheet closes, instead of back to the trigger. */
  onCloseAutoFocus?: (event: Event) => void
}

const chartLabels: Record<WidgetKind, string> = {
  stat: 'Number',
  series: 'Line',
  bars: 'Bars',
  'bar-list': 'Bar list',
  share: 'Share',
  table: 'Table',
  heatmap: 'Heatmap',
}

const chartKinds = Object.keys(chartLabels) as WidgetKind[]
const allOps = [...comparisonOps, ...membershipOps, ...presenceOps]
const noBucket = 'none'

interface FilterRow {
  id: number
  key: string
  op: Filter['op']
  text: string
}

const names = (values: readonly string[], describe?: (value: string) => string | undefined) =>
  [...new Set(values)].toSorted().map<ComboboxOption>((value) => ({
    value,
    label: value,
    ...(describe?.(value) !== undefined && { description: describe(value) }),
  }))

/** The options, plus the current value when the Inventory doesn't hold it (a typed one). */
const withCurrent = (options: ComboboxOption[], current: readonly string[]) => [
  ...options,
  ...current
    .filter((value) => value !== '' && !options.some((option) => option.value === value))
    .map<ComboboxOption>((value) => ({ value, label: value })),
]

const withoutBucket = (config: QueryWidgetConfig): QueryWidgetConfig => {
  const rest = { ...config }
  delete rest.bucket
  return rest
}

const withoutLimit = (config: QueryWidgetConfig): QueryWidgetConfig => {
  const rest = { ...config }
  delete rest.limit
  return rest
}

const messageFor = (issues: readonly QueryIssue[], field: QueryIssue['field'], show: boolean) =>
  show ? issues.find((issue) => issue.field === field)?.message : undefined

interface FormProps extends Pick<QueryWidgetEditorProps, 'inventory' | 'onSave'> {
  onCancel: () => void
}

function QueryWidgetForm({ inventory, onSave, onCancel }: FormProps) {
  const [title, setTitle] = useState('')
  const [base, setBase] = useState<QueryWidgetConfig>(() => newQueryConfig())
  const [rows, setRows] = useState<FilterRow[]>([])
  const [nextRowId, setNextRowId] = useState(0)
  // Errors appear once Save has been tried, not while a blank form is being filled in.
  const [tried, setTried] = useState(false)

  const config: QueryWidgetConfig = {
    ...base,
    filter: rows.map((row) => makeFilter(row.key, row.op, row.text)),
  }
  const issues = validateQueryConfig(config)
  const titleIssue = title.trim() === '' ? 'Name the Widget.' : undefined
  const availability = chartAvailability(config)
  const { source } = config

  const metricOptions = names(
    inventory?.metrics.map((metric) => metric.name) ?? [],
    (name) => inventory?.metrics.find((metric) => metric.name === name)?.unit ?? undefined,
  )
  const eventOptions = names(inventory?.events.map((event) => event.name) ?? [])
  const keyOptions = names(
    inventory?.attributes
      .filter((attribute) => attribute.signal === source.kind)
      .map((attribute) => attribute.key) ?? [],
  )

  /** Changes the shape (bucket, Group by) and keeps the chart kind one that can still draw it. */
  const reshape = (patch: Partial<QueryWidgetConfig>) => {
    setBase((current) => withDrawableChart({ ...current, ...patch }))
  }
  const updateRow = (id: number, patch: Partial<FilterRow>) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }

  const submit = () => {
    setTried(true)
    if (issues.length > 0 || titleIssue !== undefined) return
    onSave({ title: title.trim(), query: config })
  }

  return (
    <Stack
      as="form"
      gap={4}
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <TextField
        label="Title"
        value={title}
        onValueChange={setTitle}
        error={tried ? titleIssue : undefined}
      />

      <SelectField
        label="Signal"
        options={[
          { value: 'metric', label: 'Metric' },
          { value: 'event', label: 'Event' },
        ]}
        value={source.kind}
        onValueChange={(kind) => {
          if (kind === source.kind) return
          // Group by is cleared, which can take the chart's rows away: keep it one that draws.
          setBase((current) =>
            withDrawableChart({
              ...current,
              source:
                kind === 'metric'
                  ? { kind: 'metric', name: '', aggregation: 'sum' }
                  : { kind: 'event', name: '', aggregation: { fn: 'count' } },
              groupBy: [],
            }),
          )
        }}
      />

      <ComboboxField
        label={source.kind === 'metric' ? 'Metric' : 'Event'}
        placeholder={source.kind === 'metric' ? 'claude_code.cost.usage' : 'tool_result'}
        options={withCurrent(source.kind === 'metric' ? metricOptions : eventOptions, [
          source.name,
        ])}
        value={source.name === '' ? null : source.name}
        onValueChange={(name) => {
          setBase((current) => ({
            ...current,
            source: { ...current.source, name: name ?? '' },
          }))
        }}
        creatable
        clearable
        error={messageFor(issues, 'source', tried)}
      />

      <SelectField
        label="Aggregation"
        options={(source.kind === 'metric' ? metricAggregations : eventAggregations).map((fn) => ({
          value: fn,
          label: fn,
        }))}
        value={source.kind === 'metric' ? source.aggregation : source.aggregation.fn}
        onValueChange={(fn) => {
          setBase((current) => {
            if (current.source.kind === 'metric') {
              return {
                ...current,
                source: {
                  ...current.source,
                  aggregation: fn as (typeof metricAggregations)[number],
                },
              }
            }
            return {
              ...current,
              source: {
                ...current.source,
                aggregation:
                  fn === 'count' ? { fn } : { fn, key: current.source.aggregation.key ?? '' },
              },
            }
          })
        }}
        error={source.kind === 'metric' ? messageFor(issues, 'aggregation', tried) : undefined}
      />

      {source.kind === 'event' && source.aggregation.fn !== 'count' ? (
        <ComboboxField
          label="Aggregate attribute"
          description={
            source.aggregation.fn === 'count_distinct'
              ? 'The attribute whose distinct values are counted.'
              : 'A numeric attribute; other values are ignored.'
          }
          options={withCurrent(keyOptions, [source.aggregation.key ?? ''])}
          value={
            source.aggregation.key === undefined || source.aggregation.key === ''
              ? null
              : source.aggregation.key
          }
          onValueChange={(key) => {
            setBase((current) =>
              current.source.kind === 'event'
                ? {
                    ...current,
                    source: {
                      ...current.source,
                      aggregation: { fn: current.source.aggregation.fn, key: key ?? '' },
                    },
                  }
                : current,
            )
          }}
          creatable
          clearable
          error={messageFor(issues, 'aggregation', tried)}
        />
      ) : null}

      <ComboboxField
        multiple
        label="Group by"
        description={`Up to ${String(maxGroupBy)} keys. Pick one or type a key.`}
        options={withCurrent(keyOptions, base.groupBy)}
        value={base.groupBy}
        onValueChange={(groupBy) => {
          reshape({ groupBy })
        }}
        maxSelected={maxGroupBy}
        creatable
        error={messageFor(issues, 'groupBy', tried)}
      />

      <SelectField
        label="Time bucket"
        options={[
          { value: noBucket, label: 'None (one value per group)' },
          ...queryBuckets.map((bucket) => ({ value: bucket, label: bucket })),
        ]}
        value={base.bucket ?? noBucket}
        onValueChange={(bucket) => {
          setBase(
            withDrawableChart({
              ...withoutBucket(base),
              ...(bucket !== noBucket && { bucket: bucket as (typeof queryBuckets)[number] }),
            }),
          )
        }}
        error={messageFor(issues, 'bucket', tried)}
      />

      <Stack gap={3} role="group" aria-label="Filters">
        <Text weight="medium">Filters</Text>
        {rows.map((row, index) => (
          <Stack key={row.id} gap={2} role="group" aria-label={`Filter ${String(index + 1)}`}>
            <ComboboxField
              label="Key"
              options={withCurrent(keyOptions, [row.key])}
              value={row.key === '' ? null : row.key}
              onValueChange={(key) => {
                updateRow(row.id, { key: key ?? '' })
              }}
              creatable
            />
            <SelectField
              label="Operator"
              options={allOps.map((op) => ({ value: op, label: op }))}
              value={row.op}
              onValueChange={(op) => {
                updateRow(row.id, { op: op as Filter['op'] })
              }}
            />
            {(presenceOps as readonly string[]).includes(row.op) ? null : (
              <TextField
                label="Value"
                description={
                  (membershipOps as readonly string[]).includes(row.op)
                    ? 'Separate values with commas. Numbers and true or false match as such.'
                    : 'A number or true or false matches as such.'
                }
                value={row.text}
                onValueChange={(text) => {
                  updateRow(row.id, { text })
                }}
              />
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setRows((current) => current.filter((candidate) => candidate.id !== row.id))
              }}
            >
              {`Remove filter ${String(index + 1)}`}
            </Button>
          </Stack>
        ))}
        {messageFor(issues, 'filter', tried) === undefined ? null : (
          <Text tone="critical" role="alert">
            {messageFor(issues, 'filter', tried)}
          </Text>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={rows.length >= maxQueryFilters}
          onClick={() => {
            setRows((current) => [...current, { id: nextRowId, key: '', op: 'eq', text: '' }])
            setNextRowId((id) => id + 1)
          }}
        >
          Add filter
        </Button>
      </Stack>

      <SelectField
        label="Chart"
        description={chartKinds
          .flatMap((kind) =>
            availability[kind] === undefined ? [] : [`${chartLabels[kind]}: ${availability[kind]}`],
          )
          .join(' ')}
        options={chartKinds.map((kind) => ({
          value: kind,
          label:
            availability[kind] === undefined
              ? chartLabels[kind]
              : `${chartLabels[kind]} (unavailable)`,
          disabled: availability[kind] !== undefined,
        }))}
        value={base.chart}
        onValueChange={(chart) => {
          setBase((current) => ({ ...current, chart: chart as WidgetKind }))
        }}
        error={messageFor(issues, 'chart', tried)}
      />

      <NumberField
        label="Limit"
        description={`Rows to ask the Hub for, up to ${maxLimit.toLocaleString('en')}. With no time bucket, the largest come first. Without a limit the Hub refuses more than 10,000 rows (too-many-rows).`}
        min={1}
        max={maxLimit}
        optional
        value={base.limit ?? null}
        onValueChange={(limit) => {
          setBase((current) => ({
            ...withoutLimit(current),
            ...(limit !== null && { limit }),
          }))
        }}
        error={messageFor(issues, 'limit', tried)}
      />

      {tried && (issues.length > 0 || titleIssue !== undefined) ? (
        <Alert tone="critical" role="alert" title="This Query Widget can't be saved yet">
          {[
            ...(titleIssue === undefined ? [] : [titleIssue]),
            ...issues.map((i) => i.message),
          ].join(' ')}
        </Alert>
      ) : null}

      <Inline gap={2} justify="end">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">Save Query Widget</Button>
      </Inline>
    </Stack>
  )
}

/**
 * The editor for a Query Widget (#43), in a Sheet. It builds a `QueryWidgetConfig` from the
 * Inventory's Metrics, Events and attribute keys, and will not hand back one the Query API would
 * refuse (`validateQueryConfig`): Save shows what is wrong instead. A chart kind the rows cannot
 * draw is disabled, with the reason in the field's description.
 */
export function QueryWidgetEditor({
  open,
  onOpenChange,
  inventory,
  onSave,
  onCloseAutoFocus,
}: QueryWidgetEditorProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <Sheet.Content
        title="Add a Query Widget"
        description="Ask the Query API for any Metric or Event and pick how to draw the answer."
        size="lg"
        {...(onCloseAutoFocus !== undefined && { onCloseAutoFocus })}
      >
        <QueryWidgetForm
          inventory={inventory}
          onSave={onSave}
          onCancel={() => {
            onOpenChange(false)
          }}
        />
      </Sheet.Content>
    </Sheet>
  )
}
