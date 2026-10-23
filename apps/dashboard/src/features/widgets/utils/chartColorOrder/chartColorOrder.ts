/** Token types in the order every chart colours them; others follow alphabetically. */
const tokenTypes = ['input', 'output', 'cacheRead', 'cacheCreation']

/**
 * The `order` for a Board's `ChartColorScope`: models first, then token types. Models sort by
 * name, so a model keeps its colour in every chart and across reloads, whichever Widget happens to
 * render first.
 */
export function chartColorOrder(keys: { models: readonly string[]; types?: readonly string[] }) {
  const types = keys.types ?? tokenTypes
  const known = tokenTypes.filter((type) => types.includes(type))
  const others = types.filter((type) => !tokenTypes.includes(type)).toSorted()
  return [...keys.models.toSorted(), ...known, ...others]
}
