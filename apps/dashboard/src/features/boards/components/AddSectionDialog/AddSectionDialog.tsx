import { Button, Dialog, Input } from '@mitcsutt/kiln-ui'
import { useState } from 'react'

export interface AddSectionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdd: (title: string) => void
  onOpenAutoFocus: (event: Event) => void
  onCloseAutoFocus: (event: Event) => void
}

/** Asks for the heading of a new section, then adds it. */
export function AddSectionDialog({
  open,
  onOpenChange,
  onAdd,
  onOpenAutoFocus,
  onCloseAutoFocus,
}: AddSectionDialogProps) {
  const [title, setTitle] = useState('')
  const trimmed = title.trim()
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) setTitle('')
      }}
    >
      <Dialog.Content
        title="Add a section"
        description="A heading across the full width."
        size="sm"
        onOpenAutoFocus={onOpenAutoFocus}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (trimmed === '') return
            onAdd(trimmed)
            setTitle('')
          }}
        >
          <Input
            aria-label="Section title"
            placeholder="Section title"
            maxLength={200}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value)
            }}
          />
          <Dialog.Footer>
            <Dialog.Close asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Dialog.Close>
            <Button type="submit" disabled={trimmed === ''}>
              Add section
            </Button>
          </Dialog.Footer>
        </form>
      </Dialog.Content>
    </Dialog>
  )
}
