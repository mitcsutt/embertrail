import type { ComboboxOption } from '@mitcsutt/kiln-ui'

import type { Inventory } from '#features/filters/data/inventory'

export interface FilterOptions {
  sources: ComboboxOption[]
  accounts: ComboboxOption[]
  models: ComboboxOption[]
}

/** The current pick is always offered, so a value the window no longer holds still shows. */
function withCurrent(options: ComboboxOption[], current: string | undefined): ComboboxOption[] {
  if (current === undefined || options.some(({ value }) => value === current)) return options
  return [{ value: current, label: current }, ...options]
}

/**
 * The options for the Source, Account and model pickers. An Account is named by its label, with
 * its email under it; a Source by its name. The Owner is shown only when the Inventory holds more
 * than one, so a solo Hub never sees one. Owner names are the Hub's: an id until a User is named.
 */
export function filterOptions(
  inventory: Inventory | undefined,
  current: { sourceId?: string; accountId?: string; model?: string },
): FilterOptions {
  const owners = new Map((inventory?.owners ?? []).map(({ id, name }) => [id, name]))
  const several = owners.size > 1
  const owner = (id: string) => (several ? (owners.get(id) ?? id) : undefined)

  const sources = (inventory?.sources ?? []).map(({ id, name, owner_id }) => ({
    value: id,
    label: name,
    description: owner(owner_id),
  }))
  const accounts = (inventory?.accounts ?? []).map(({ id, label, email, owner_id }) => ({
    value: id,
    label,
    description: [email, owner(owner_id)].filter((part) => part != null).join(' · ') || undefined,
  }))
  const models = (inventory?.models ?? []).map((model) => ({ value: model, label: model }))

  return {
    sources: withCurrent(sources, current.sourceId),
    accounts: withCurrent(accounts, current.accountId),
    models: withCurrent(models, current.model),
  }
}
