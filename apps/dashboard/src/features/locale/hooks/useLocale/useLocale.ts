import { usePreferences } from '#features/locale/stores/preferences'
import { currencyFor } from '#features/locale/utils/regionCurrency'

export interface ResolvedLocale {
  /** The tag numbers and dates are written in. */
  locale: string
  /** The currency the viewer asked for (not necessarily one the Hub has a rate for). */
  currency: string
  /** Whether the locale and the currency are the browser's, not chosen. */
  automatic: { locale: boolean; currency: boolean }
}

/** The locale and currency in force: the viewer's choice, else the browser's language. */
export function useLocale(): ResolvedLocale {
  const { locale, currency } = usePreferences()
  const resolved = locale ?? navigator.language
  return {
    locale: resolved,
    currency: currency ?? currencyFor(resolved),
    automatic: { locale: locale === null, currency: currency === null },
  }
}
