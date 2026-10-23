import type { QueryContext } from '#features/filters/types/filters'
import { WidgetFrame } from '#features/widgets/components/WidgetFrame'
import { useWidgetData } from '#features/widgets/hooks/useWidgetData'
import type { WidgetDefinition } from '#features/widgets/types/widget'

/** One Widget of the Catalogue: its data, its frame and its view. */
export function Widget({
  definition,
  ctx,
  pinned,
}: {
  definition: WidgetDefinition
  ctx: QueryContext
  /** Which filters the Board pins on this Widget, for the frame to say. */
  pinned?: string
}) {
  const { status, data, inventory, error, refetch } = useWidgetData(definition, ctx)
  return (
    <WidgetFrame
      title={definition.title}
      status={status}
      error={error}
      onRetry={refetch}
      pinned={pinned}
      showTitle={definition.kind !== 'stat'}
      height={definition.kind === 'bars' || definition.kind === 'series' ? 'fill' : 'auto'}
    >
      {data === undefined ? null : (
        <definition.View
          data={data}
          ctx={ctx}
          status={status}
          label={definition.title}
          inventory={inventory}
        />
      )}
    </WidgetFrame>
  )
}
