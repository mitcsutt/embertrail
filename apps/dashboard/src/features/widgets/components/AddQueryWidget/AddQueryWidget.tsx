import { Button } from '@mitcsutt/kiln-ui'
import { useState } from 'react'

import type { Inventory } from '#features/filters/data/inventory'
import { QueryWidgetEditor } from '#features/widgets/components/QueryWidgetEditor'
import type { QueryWidgetValue } from '#features/widgets/components/QueryWidgetEditor'

export interface AddQueryWidgetProps {
  inventory: Inventory | undefined
  /** Called with the saved Query Widget; the caller appends it to the Board. */
  onAdd: (value: QueryWidgetValue) => void
}

/**
 * The entry point for a new Query Widget: a button that opens the editor. The Board editor (#72
 * D7) mounts it beside "Add Widget" and appends the item at `queryWidgetSize(value.query.chart)`.
 */
export function AddQueryWidget({ inventory, onAdd }: AddQueryWidgetProps) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setOpen(true)
        }}
      >
        Add Query Widget
      </Button>
      <QueryWidgetEditor
        open={open}
        onOpenChange={setOpen}
        inventory={inventory}
        onSave={(value) => {
          setOpen(false)
          onAdd(value)
        }}
      />
    </>
  )
}
