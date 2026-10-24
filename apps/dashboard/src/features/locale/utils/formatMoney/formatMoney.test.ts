import { describe, expect, it } from 'vitest'

import { formatMoney } from './formatMoney'

const plainSpaces = (text: string) => text.replaceAll(/\s/g, ' ')

describe('formatMoney', () => {
  it('writes USD as it is without a rate', () => {
    expect(formatMoney(1234.5, { locale: 'en-US', currency: 'USD', rate: undefined })).toBe(
      '$1,234.50',
    )
    expect(
      plainSpaces(formatMoney(1234.5, { locale: 'de-DE', currency: 'USD', rate: undefined })),
    ).toBe('1.234,50 $')
  })

  it('converts at the rate and marks the figure as an estimate', () => {
    expect(formatMoney(10, { locale: 'en-AU', currency: 'AUD', rate: 1.5 })).toBe('≈ $15.00')
    expect(plainSpaces(formatMoney(10, { locale: 'de-DE', currency: 'EUR', rate: 0.9 }))).toBe(
      '≈ 9,00 €',
    )
  })

  it('never converts an amount that is already in the shown currency', () => {
    expect(
      formatMoney(15, { locale: 'en-AU', currency: 'AUD', rate: undefined, plain: true }),
    ).toBe('$15.00')
  })

  it('writes a fixed number of places for a tiny amount', () => {
    expect(
      formatMoney(0.0123, { locale: 'en-US', currency: 'USD', rate: undefined, digits: 4 }),
    ).toBe('$0.0123')
    expect(formatMoney(0.01, { locale: 'en-AU', currency: 'AUD', rate: 1.5, digits: 4 })).toBe(
      '≈ $0.0150',
    )
  })
})
