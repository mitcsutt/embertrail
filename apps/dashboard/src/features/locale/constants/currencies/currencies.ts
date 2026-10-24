/** The euro area, whose members share one currency. */
const euroArea = [
  'AT', 'BE', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT',
  'NL', 'PT', 'SI', 'SK',
] // prettier-ignore

/** Region to currency, for the currencies the ECB publishes a rate for. Any other region reads USD. */
export const regionCurrency: Readonly<Record<string, string>> = {
  AU: 'AUD', BG: 'BGN', BR: 'BRL', CA: 'CAD', CH: 'CHF', CN: 'CNY', CZ: 'CZK', DK: 'DKK',
  GB: 'GBP', HK: 'HKD', HU: 'HUF', ID: 'IDR', IL: 'ILS', IN: 'INR', IS: 'ISK', JP: 'JPY',
  KR: 'KRW', MX: 'MXN', MY: 'MYR', NO: 'NOK', NZ: 'NZD', PH: 'PHP', PL: 'PLN', RO: 'RON',
  SE: 'SEK', SG: 'SGD', TH: 'THB', TR: 'TRY', US: 'USD', ZA: 'ZAR',
  ...Object.fromEntries(euroArea.map((region) => [region, 'EUR'])),
} // prettier-ignore

/** Offered while the Hub's rates are not loaded, so a choice can still be made and kept. */
export const commonCurrencies = [
  'USD',
  'AUD',
  'EUR',
  'GBP',
  'CAD',
  'NZD',
  'JPY',
  'CHF',
  'SGD',
  'INR',
] as const

/** The locales the picker offers besides the browser's own; any tag the browser knows also works through storage. */
export const commonLocales = [
  'en-AU', 'en-US', 'en-GB', 'en-CA', 'en-NZ', 'en-IN', 'de-DE', 'fr-FR', 'es-ES', 'it-IT',
  'pt-BR', 'nl-NL', 'sv-SE', 'ja-JP', 'ko-KR', 'zh-CN',
] as const // prettier-ignore
