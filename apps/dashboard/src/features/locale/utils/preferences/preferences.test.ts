import { describe, expect, it } from 'vitest'

import { parsePreferences } from './preferences'

describe('parsePreferences', () => {
  it('follows the browser when nothing is stored', () => {
    expect(parsePreferences(null)).toEqual({ locale: null, currency: null })
  })

  it('reads a stored choice', () => {
    expect(parsePreferences('{"locale":"en-AU","currency":"AUD"}')).toEqual({
      locale: 'en-AU',
      currency: 'AUD',
    })
  })

  it('drops a choice that is not valid, and keeps the other', () => {
    expect(parsePreferences('{"locale":"en_AU","currency":"AUD"}')).toEqual({
      locale: null,
      currency: 'AUD',
    })
    expect(parsePreferences('{"locale":"en-AU","currency":"aud"}')).toEqual({
      locale: 'en-AU',
      currency: null,
    })
  })

  it('survives text that is not JSON', () => {
    expect(parsePreferences('{oops')).toEqual({ locale: null, currency: null })
  })
})
