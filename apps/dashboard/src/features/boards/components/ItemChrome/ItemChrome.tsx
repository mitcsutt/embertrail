import { DragHandle } from '@mitcsutt/kiln-dnd'
import { CloseIcon, IconButton, Inline } from '@mitcsutt/kiln-ui'
import type { ReactNode, Ref } from 'react'

export interface ItemChromeProps {
  /** The item's name, for the handle and the Remove button. */
  label: string
  /** A static item (a section) cannot be picked up, so it has no handle. */
  movable: boolean
  handleRef: Ref<HTMLButtonElement>
  onRemove: () => void
  /** More controls, before Remove: a Widget's pinned filters. */
  actions?: ReactNode
  children: ReactNode
}

/**
 * What a Board item wears in edit mode: a handle to pick it up by (Space or Enter, then the
 * arrows; Shift and the arrows resize), Remove, and any controls of its own, above the item.
 */
export function ItemChrome({
  label,
  movable,
  handleRef,
  onRemove,
  actions,
  children,
}: ItemChromeProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Inline justify="between" align="center" gap={2}>
        {movable ? <DragHandle ref={handleRef} /> : <span />}
        <Inline gap={1} align="center">
          {actions}
          <IconButton
            size="sm"
            variant="ghost"
            label={`Remove ${label}`}
            icon={<CloseIcon />}
            onClick={onRemove}
          />
        </Inline>
      </Inline>
      <div style={{ flex: '1 1 0', minHeight: 0, overflow: 'auto' }}>{children}</div>
    </div>
  )
}
