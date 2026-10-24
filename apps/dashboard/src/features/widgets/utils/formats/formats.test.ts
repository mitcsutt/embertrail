import { describe, expect, it } from 'vitest'

import { formatDuration, formatPercent, formatTokens } from './formats'

describe('formats', () => {
  it('writes token counts short', () => {
    expect(formatTokens(950, 'en-US')).toBe('950')
    expect(formatTokens(12_400, 'en-US')).toBe('12.4K')
    expect(formatTokens(3_400_000, 'en-US')).toBe('3.4M')
  })

  it('writes a fraction as a percentage', () => {
    expect(formatPercent(0.125, 'en-US')).toBe('12.5%')
    expect(formatPercent(1, 'en-US')).toBe('100%')
  })

  it.each([
    [0, '0 ms'],
    [250, '250 ms'],
    [45_000, '45 s'],
    [60_000, '1 min'],
    [4_800_000, '1 h 20 min'],
    [3_600_000, '1 h'],
    [90_061_000, '1 d 1 h'],
  ])('writes %d ms as %s', (ms, text) => {
    expect(formatDuration(ms)).toBe(text)
  })
})
