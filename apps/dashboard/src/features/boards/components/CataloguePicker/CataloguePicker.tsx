import { Button, Heading, Input, Sheet, Stack, Text } from '@mitcsutt/kiln-ui'
import { useMemo, useState } from 'react'

import { groupTitles } from '#features/boards/utils/presets'
import { catalogue } from '#features/widgets/constants/catalogue'
import type { WidgetDefinition, WidgetGroup } from '#features/widgets/types/widget'

export interface CataloguePickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdd: (widget: WidgetDefinition) => void
  /** Runs as the sheet opens, while focus is still on what opened it. */
  onOpenAutoFocus: (event: Event) => void
  /** Where focus goes when the sheet closes. */
  onCloseAutoFocus: (event: Event) => void
}

const matches = (widget: WidgetDefinition, query: string): boolean =>
  query === '' ||
  `${widget.title} ${widget.description ?? ''} ${groupTitles[widget.group]}`
    .toLowerCase()
    .includes(query)

/** The Catalogue in a Sheet, grouped as the Everything Board groups it and searchable by name. */
export function CataloguePicker({
  open,
  onOpenChange,
  onAdd,
  onOpenAutoFocus,
  onCloseAutoFocus,
}: CataloguePickerProps) {
  const [query, setQuery] = useState('')
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const byGroup = new Map<WidgetGroup, WidgetDefinition[]>()
    for (const widget of catalogue.filter((entry) => matches(entry, needle))) {
      byGroup.set(widget.group, [...(byGroup.get(widget.group) ?? []), widget])
    }
    return [...byGroup]
  }, [query])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <Sheet.Content
        title="Add a Widget"
        description="Pick a Widget from the Catalogue to put at the bottom of the Board."
        onOpenAutoFocus={onOpenAutoFocus}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <Stack gap={4}>
          <Input
            type="search"
            aria-label="Search the Catalogue"
            placeholder="Search Widgets"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
            }}
          />
          {groups.length === 0 ? (
            <Text tone="muted">No Widget matches that.</Text>
          ) : (
            groups.map(([group, widgets]) => (
              <Stack as="section" key={group} gap={2} aria-label={groupTitles[group]}>
                <Heading level={3} size="md">
                  {groupTitles[group]}
                </Heading>
                {widgets.map((widget) => (
                  <Button
                    key={widget.id}
                    variant="outline"
                    onClick={() => {
                      onAdd(widget)
                    }}
                  >
                    {`Add ${widget.title}`}
                  </Button>
                ))}
              </Stack>
            ))
          )}
        </Stack>
      </Sheet.Content>
    </Sheet>
  )
}
