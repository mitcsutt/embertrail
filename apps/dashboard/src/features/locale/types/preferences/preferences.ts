/** What the viewer chose; `null` follows the browser. Stored in the browser, per device. */
export interface LocalePreferences {
  /** A BCP 47 tag such as `en-AU`. `null`: the browser's language. */
  locale: string | null
  /** An ISO 4217 code such as `AUD`. `null`: the currency of the locale's region. */
  currency: string | null
}

export const automatic: LocalePreferences = { locale: null, currency: null }
