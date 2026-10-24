export interface MoneyFormat {
  locale: string | undefined
  /** What to show. USD, or the same as `rate`'s currency. */
  currency: string
  /** Units of `currency` per 1 USD; `undefined` shows the USD as it is. */
  rate: number | undefined
  /** An amount that is already in `currency`: written as it is, with no conversion or `≈`. */
  plain?: boolean
  /** Fixed decimal places, for amounts too small for the currency's usual two (an API call). */
  digits?: number
}

/** USD amounts as the viewer reads money: converted at `rate` and marked `≈` when it is. */
export function formatMoney(
  usd: number,
  { locale, currency, rate, plain, digits }: MoneyFormat,
): string {
  const places =
    digits === undefined ? {} : { minimumFractionDigits: digits, maximumFractionDigits: digits }
  const write = (amount: number, code: string) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: code, ...places }).format(amount)
  if (plain === true) return write(usd, currency)
  if (rate === undefined || currency === 'USD') return write(usd, 'USD')
  return `≈ ${write(usd * rate, currency)}`
}
