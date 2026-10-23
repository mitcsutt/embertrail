import type { WidgetDefinition } from '#features/widgets/types/widget'

/**
 * Registers a Widget typed by its data as a Catalogue entry. The Catalogue holds Widgets of every
 * data shape, so the definition is widened once, here, instead of at each use.
 */
export function asCatalogueEntry<Data>(definition: WidgetDefinition<Data>): WidgetDefinition {
  return definition as unknown as WidgetDefinition
}
