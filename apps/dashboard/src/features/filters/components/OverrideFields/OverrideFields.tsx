import { Combobox, Select, Stack } from '@mitcsutt/kiln-ui'
import { useMemo } from 'react'

import { relativeRanges } from '#features/filters/constants/relativeRanges'
import type { Inventory } from '#features/filters/data/inventory'
import type { FilterOverride, RelativeRange } from '#features/filters/types/filters'
import { filterOptions } from '#features/filters/utils/filterOptions'

export interface OverrideFieldsProps {
  override: FilterOverride | undefined
  /** Called with the whole override; a field set to `undefined` follows the Board again. */
  onChange: (override: FilterOverride) => void
  inventory: Inventory | undefined
  loading?: boolean
}

const followBoard = 'board'
const asRange = (value: string) => value as RelativeRange

/**
 * The pickers that pin filters on one Widget: a time range and a Source, Account and model that
 * win over the Board's. A field left empty follows the Board. A range pinned as dates is not
 * offered here (the Board's filter bar sets those); one already stored is shown and kept.
 */
export function OverrideFields({ override, onChange, inventory, loading }: OverrideFieldsProps) {
  const options = useMemo(
    () =>
      filterOptions(inventory, {
        sourceId: override?.sourceId,
        accountId: override?.accountId,
        model: override?.model,
      }),
    [inventory, override?.sourceId, override?.accountId, override?.model],
  )
  const time = override?.time
  const timeOptions = [
    { value: followBoard, label: 'Follow the Board' },
    ...relativeRanges,
    ...(time?.kind === 'absolute'
      ? [{ value: 'dates', label: `${time.from} to ${time.to}`, disabled: true }]
      : []),
  ]
  const patch = (next: FilterOverride) => {
    onChange({ ...override, ...next })
  }

  return (
    <Stack gap={3}>
      <Select
        aria-label="Time range"
        options={timeOptions}
        value={time === undefined ? followBoard : time.kind === 'relative' ? time.range : 'dates'}
        onValueChange={(value) => {
          patch({
            time: value === followBoard ? undefined : { kind: 'relative', range: asRange(value) },
          })
        }}
      />
      <Combobox
        aria-label="Source"
        placeholder="Follow the Board"
        options={options.sources}
        value={override?.sourceId ?? null}
        onValueChange={(value) => {
          patch({ sourceId: value ?? undefined })
        }}
        loading={loading}
        clearable
        clearLabel="Clear Source"
      />
      <Combobox
        aria-label="Account"
        placeholder="Follow the Board"
        options={options.accounts}
        value={override?.accountId ?? null}
        onValueChange={(value) => {
          patch({ accountId: value ?? undefined })
        }}
        loading={loading}
        clearable
        clearLabel="Clear Account"
      />
      <Combobox
        aria-label="Model"
        placeholder="Follow the Board"
        options={options.models}
        value={override?.model ?? null}
        onValueChange={(value) => {
          patch({ model: value ?? undefined })
        }}
        loading={loading}
        clearable
        clearLabel="Clear model"
      />
    </Stack>
  )
}
