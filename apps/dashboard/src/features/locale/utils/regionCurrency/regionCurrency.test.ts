import { describe, expect, it } from 'vitest'

import { currencyFor, isLocale } from './regionCurrency'

describe('currencyFor', () => {
  it.each([
    ['en-AU', 'AUD'],
    ['en-US', 'USD'],
    ['en-GB', 'GBP'],
    ['de-DE', 'EUR'],
    ['fr-FR', 'EUR'],
    ['ja-JP', 'JPY'],
    ['en-NZ', 'NZD'],
  ])('reads %s as %s', (locale, currency) => {
    expect(currencyFor(locale)).toBe(currency)
  })

  it('guesses the region of a bare language', () => {
    expect(currencyFor('de')).toBe('EUR')
    expect(currencyFor('ja')).toBe('JPY')
  })

  it('falls back to USD for a region without an ECB rate, or a tag it cannot read', () => {
    expect(currencyFor('ar-SA')).toBe('USD')
    expect(currencyFor('not a locale')).toBe('USD')
  })
})

describe('isLocale', () => {
  it('accepts a BCP 47 tag and refuses anything else', () => {
    expect(isLocale('en-AU')).toBe(true)
    expect(isLocale('en_AU')).toBe(false)
    expect(isLocale('')).toBe(false)
  })
})
