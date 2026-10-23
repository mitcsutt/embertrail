import type { QueryContext } from '#features/filters/types/filters'
import { WidgetFrame } from '#features/widgets/components/WidgetFrame'
import { useWidgetData } from '#features/widgets/hooks/useWidgetData'
import type { WidgetDefinition } from '#features/widgets/types/widget'

/** One Widget of the Catalogue: its data, its frame and its view. */
export function Widget({
  definition,
  ctx,
  title = definition.title,
}: {
  definition: WidgetDefinition
  ctx: QueryContext
  /** Overrides the Catalogue title, for a Widget a Board has renamed. */
  title?: string
}) {
  const { status, data, error, refetch } = useWidgetData(definition, ctx)
  return (
    <WidgetFrame
      title={title}
      status={status}
      error={error}
      onRetry={refetch}
      showTitle={definition.kind !== 'stat'}
      height={definition.kind === 'bars' || definition.kind === 'series' ? 'fill' : 'auto'}
    >
      {data === undefined ? null : (
        <definition.View data={data} ctx={ctx} status={status} label={title} />
      )}
    </WidgetFrame>
  )
}
