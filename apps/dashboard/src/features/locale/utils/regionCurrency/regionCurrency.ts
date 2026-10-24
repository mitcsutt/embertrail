import { regionCurrency } from '#features/locale/constants/currencies'

/** The currency people in a locale's region use, or `USD` when it is not one the ECB publishes. */
export function currencyFor(locale: string): string {
  try {
    const region = new Intl.Locale(locale).maximize().region
    return (region === undefined ? undefined : regionCurrency[region]) ?? 'USD'
  } catch {
    return 'USD'
  }
}

/** Whether the browser can format with this tag. */
export function isLocale(tag: string): boolean {
  try {
    return Intl.getCanonicalLocales(tag).length === 1
  } catch {
    return false
  }
}
