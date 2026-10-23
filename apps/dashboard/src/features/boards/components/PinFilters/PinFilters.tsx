import { Button, Popover, Stack, Text } from '@mitcsutt/kiln-ui'

import { OverrideFields } from '#features/filters/components/OverrideFields'
import type { Inventory } from '#features/filters/data/inventory'
import type { FilterOverride } from '#features/filters/types/filters'

export interface PinFiltersProps {
  /** The Widget's name, for the trigger's accessible name. */
  title: string
  override: FilterOverride | undefined
  onChange: (override: FilterOverride | undefined) => void
  inventory: Inventory | undefined
}

/**
 * Pins filters on one Widget: its own time range, Source, Account and model, which win over the
 * Board's. The Widget keeps them when the Board's filters change.
 */
export function PinFilters({ title, override, onChange, inventory }: PinFiltersProps) {
  return (
    <Popover>
      <Popover.Trigger asChild>
        <Button size="sm" variant="ghost" aria-label={`Pin filters for ${title}`}>
          Pin filters
        </Button>
      </Popover.Trigger>
      <Popover.Content aria-label={`Pinned filters for ${title}`}>
        <Stack gap={3}>
          <Text size="sm" tone="muted">
            A pinned filter stays when the Board&apos;s filters change.
          </Text>
          <OverrideFields override={override} onChange={onChange} inventory={inventory} />
          <Button
            size="sm"
            variant="outline"
            disabled={override === undefined}
            onClick={() => {
              onChange(undefined)
            }}
          >
            Unpin all
          </Button>
        </Stack>
      </Popover.Content>
    </Popover>
  )
}
