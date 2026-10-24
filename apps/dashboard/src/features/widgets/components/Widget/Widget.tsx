import type { QueryContext } from '#features/filters/types/filters'
import { WidgetFrame } from '#features/widgets/components/WidgetFrame'
import { useWidgetData } from '#features/widgets/hooks/useWidgetData'
import type { WidgetDefinition } from '#features/widgets/types/widget'

/** One Widget of the Catalogue: its data, its frame and its view. */
export function Widget({
  definition,
  ctx,
  pinned,
  level,
}: {
  definition: WidgetDefinition
  ctx: QueryContext
  /** Which filters the Board pins on this Widget, for the frame to say. */
  pinned?: string
  /** The title's heading level, from the Board's sections. */
  level?: 2 | 3
}) {
  const { status, data, inventory, error, refetch } = useWidgetData(definition, ctx)
  return (
    <WidgetFrame
      title={definition.title}
      status={status}
      error={error}
      onRetry={refetch}
      pinned={pinned}
      level={level}
      filtered={ctx.filter.length > 0}
      // A stat names itself, but only once it draws: loading, empty or failed, the frame does.
      showTitle={definition.kind !== 'stat' || status !== 'ready'}
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
