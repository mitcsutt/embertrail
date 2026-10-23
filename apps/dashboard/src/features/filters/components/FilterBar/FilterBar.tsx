import { Combobox, DateRangePickerField, Inline, Select } from '@mitcsutt/kiln-ui'
import type { DateRangeValue } from '@mitcsutt/kiln-ui'
import { useMemo, useState } from 'react'

import { relativeRanges } from '#features/filters/constants/relativeRanges'
import type { Inventory } from '#features/filters/data/inventory'
import type { BoardFilters, RelativeRange } from '#features/filters/types/filters'
import { filterOptions } from '#features/filters/utils/filterOptions'
import { absoluteRange, isCalendarDate } from '#features/filters/utils/resolveWindow'

export interface FilterBarProps {
  filters: BoardFilters
  /** Called with only the filters that changed; a key set to `undefined` clears that filter. */
  onChange: (patch: Partial<BoardFilters>) => void
  /** What the pickers offer. Undefined while it loads. */
  inventory: Inventory | undefined
  loading?: boolean
  /** The zone days are read in, and the "today" of the calendar. */
  tz: string
  now?: Date
}

const rangeOptions = [...relativeRanges, { value: 'custom', label: 'Custom…' }]

const asRange = (value: string) => value as RelativeRange

/**
 * The Board's filters: a time range (with a custom date range), and one Source, Account and model.
 * Every control is a native-keyboard Kiln control, so Tab and the arrow keys are all it takes.
 */
export function FilterBar({ filters, onChange, inventory, loading, tz, now }: FilterBarProps) {
  const options = useMemo(
    () =>
      filterOptions(inventory, {
        sourceId: filters.sourceId,
        accountId: filters.accountId,
        model: filters.model,
      }),
    [inventory, filters.sourceId, filters.accountId, filters.model],
  )
  const custom = filters.time.kind === 'absolute'

  const chooseRange = (value: string) => {
    if (value === 'custom') {
      onChange({ time: absoluteRange(filters.time, now ?? new Date(), tz) })
    } else {
      onChange({ time: { kind: 'relative', range: asRange(value) } })
    }
  }

  return (
    <Inline gap={3} align="end" role="group" aria-label="Filters">
      <Select
        aria-label="Time range"
        options={rangeOptions}
        value={
          custom ? 'custom' : filters.time.kind === 'relative' ? filters.time.range : undefined
        }
        onValueChange={chooseRange}
      />
      {filters.time.kind === 'absolute' && (
        <CustomRange
          from={filters.time.from}
          to={filters.time.to}
          tz={tz}
          onCommit={(from, to) => {
            onChange({ time: { kind: 'absolute', from, to } })
          }}
        />
      )}
      <Combobox
        aria-label="Source"
        placeholder="All Sources"
        options={options.sources}
        value={filters.sourceId ?? null}
        onValueChange={(value) => {
          onChange({ sourceId: value ?? undefined })
        }}
        loading={loading}
        clearable
        clearLabel="Clear Source"
      />
      <Combobox
        aria-label="Account"
        placeholder="All Accounts"
        options={options.accounts}
        value={filters.accountId ?? null}
        onValueChange={(value) => {
          onChange({ accountId: value ?? undefined })
        }}
        loading={loading}
        clearable
        clearLabel="Clear Account"
      />
      <Combobox
        aria-label="Model"
        placeholder="All models"
        options={options.models}
        value={filters.model ?? null}
        onValueChange={(value) => {
          onChange({ model: value ?? undefined })
        }}
        loading={loading}
        clearable
        clearLabel="Clear model"
      />
    </Inline>
  )
}

interface CustomRangeProps {
  from: string
  to: string
  tz: string
  onCommit: (from: string, to: string) => void
}

/**
 * The calendar for a custom range. Typing a date passes through unfinished values, so the picker
 * keeps its own draft and the Board hears only about a whole range whose start is not after its end.
 */
function CustomRange({ from, to, tz, onCommit }: CustomRangeProps) {
  const [draft, setDraft] = useState<DateRangeValue>({ start: from, end: to })
  const [seen, setSeen] = useState({ from, to })
  // A range that arrives from outside (the URL changed) replaces the draft.
  if (seen.from !== from || seen.to !== to) {
    setSeen({ from, to })
    setDraft({ start: from, end: to })
  }

  return (
    <DateRangePickerField
      label="Dates"
      labelHidden
      timeZone={tz}
      value={draft}
      onValueChange={(value) => {
        setDraft(value)
        if (isCalendarDate(value.start) && isCalendarDate(value.end) && value.start <= value.end) {
          onCommit(value.start, value.end)
        }
      }}
    />
  )
}
