import { Button, Dialog } from '@mitcsutt/kiln-ui'

import type { BoardConflict } from '#features/boards/data/boards'

export interface ConflictDialogProps {
  /** The lost write; the dialog is open while there is one. */
  conflict: BoardConflict | undefined
  /** Discard the draft and show the Hub's copy. */
  onReload: () => void
  /** Close the dialog and go on editing the draft. */
  onKeepEditing: () => void
}

function describe(conflict: BoardConflict): string {
  if (conflict.current !== undefined) {
    return 'Someone saved a newer version of this Board while you were editing. Reload shows theirs and discards your changes; Keep editing leaves your draft here, and saving it again will ask again.'
  }
  if (conflict.cause === undefined) {
    return 'This Board was deleted while you were editing. Reload discards your draft and goes back to the Overview.'
  }
  return 'A newer version of this Board exists but cannot be read. Reload tries again and discards your draft; Keep editing leaves it here.'
}

/** Shown when a save or a delete loses to another change. The Board is never overwritten silently. */
export function ConflictDialog({ conflict, onReload, onKeepEditing }: ConflictDialogProps) {
  return (
    <Dialog
      open={conflict !== undefined}
      onOpenChange={(open) => {
        if (!open) onKeepEditing()
      }}
    >
      <Dialog.Content
        title="This Board changed elsewhere"
        description={conflict === undefined ? undefined : describe(conflict)}
        hideClose
      >
        <Dialog.Footer>
          <Button variant="outline" onClick={onKeepEditing}>
            Keep editing
          </Button>
          <Button onClick={onReload}>Reload</Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  )
}
