import type { LocalePreferences } from '#features/locale/types/preferences'
import { automatic } from '#features/locale/types/preferences'

import { isLocale } from '#features/locale/utils/regionCurrency'

/** Reads what was stored; anything that does not parse leaves that choice on automatic. */
export function parsePreferences(stored: string | null): LocalePreferences {
  if (stored === null) return automatic
  try {
    const value = JSON.parse(stored) as Record<string, unknown>
    const locale = typeof value.locale === 'string' && isLocale(value.locale) ? value.locale : null
    const currency =
      typeof value.currency === 'string' && /^[A-Z]{3}$/.test(value.currency)
        ? value.currency
        : null
    return { locale, currency }
  } catch {
    return automatic
  }
}
