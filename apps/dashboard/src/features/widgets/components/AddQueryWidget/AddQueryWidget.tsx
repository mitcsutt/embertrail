import { Button } from '@mitcsutt/kiln-ui'
import { useState } from 'react'

import type { Inventory } from '#features/filters/data/inventory'
import { useReturnFocus } from '#features/widgets/hooks/useReturnFocus'
import { QueryWidgetEditor } from '#features/widgets/components/QueryWidgetEditor'
import type { QueryWidgetValue } from '#features/widgets/components/QueryWidgetEditor'
import { queryWidgetSize } from '#features/widgets/utils/queryWidgetDefinition'

export interface AddQueryWidgetProps {
  inventory: Inventory | undefined
  /** Called with the saved Query Widget and the Layout size its chart kind starts at. */
  onAdd: (value: QueryWidgetValue & { size: { w: number; h: number } }) => void
  /** Where focus goes when the editor closes after an add; otherwise it goes back to the button. */
  onCloseAutoFocus?: (event: Event) => void
}

/**
 * The entry point for a new Query Widget: a button that opens the editor. The Board editor mounts
 * it beside "Add Widget" and appends the item at the size it reports.
 */
export function AddQueryWidget({ inventory, onAdd, onCloseAutoFocus }: AddQueryWidgetProps) {
  const [open, setOpen] = useState(false)
  const returnFocus = useReturnFocus(onCloseAutoFocus)
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
          onAdd({ ...value, size: queryWidgetSize(value.query.chart) })
        }}
        onOpenAutoFocus={returnFocus.onOpenAutoFocus}
        onCloseAutoFocus={returnFocus.onCloseAutoFocus}
      />
    </>
  )
}
