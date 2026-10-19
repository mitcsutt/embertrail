import { describe, expect, it } from 'vitest'

import { attributes, canonical, microsToNanos, nanosToIso, unwrap, wrap } from './otlp'

describe('OTLP/JSON values', () => {
  it.each([
    [{ stringValue: 'a' }, 'a'],
    [{ boolValue: false }, false],
    [{ intValue: 5 }, 5],
    [{ intValue: '5' }, 5],
    [{ intValue: '-12' }, -12],
    [{ intValue: '9007199254740993' }, '9007199254740993'],
    [{ doubleValue: 1.5 }, 1.5],
    [{ doubleValue: 'NaN' }, 'NaN'],
    [{ bytesValue: 'AQID' }, 'AQID'],
    [{ arrayValue: { values: [{ intValue: 1 }, {}] } }, [1, null]],
    [{ kvlistValue: { values: [{ key: 'k', value: { stringValue: 'v' } }] } }, { k: 'v' }],
    [{}, null],
    ['junk', null],
  ])('unwraps %j', (value, expected) => {
    expect(unwrap(value)).toEqual(expected)
  })

  it('keeps the last of a repeated key and skips entries without one', () => {
    expect(
      attributes([
        { key: 'a', value: { intValue: 1 } },
        { value: { intValue: 2 } },
        { key: 'a', value: { intValue: 3 } },
      ]),
    ).toEqual({ a: 3 })
  })

  it('wraps plain JSON back so that unwrapping it is lossless', () => {
    const value = { s: 'x', i: 3, d: 0.25, b: true, n: null, l: [1, 'two'], o: { k: [false] } }
    expect(Object.keys(wrap(value))).toEqual(['kvlistValue'])
    expect(wrap(3)).toEqual({ intValue: '3' })
    expect(unwrap(wrap(value))).toEqual(value)
  })

  it('converts nanosecond timestamps to microsecond ISO strings and back', () => {
    expect(nanosToIso('1792396800123456789')).toBe('2026-10-19T08:00:00.123456Z')
    expect(nanosToIso(Number('1792396800123456789'))).toMatch(/^2026-10-19T08:00:00\.123\d{3}Z$/)
    expect(nanosToIso('0')).toBeNull()
    expect(nanosToIso(undefined)).toBeNull()
    expect(nanosToIso('soon')).toBeNull()
    expect(nanosToIso('253402300799999999999')).toBe('9999-12-31T23:59:59.999999Z')
    expect(nanosToIso('253402300800000000000')).toBeNull()
    expect(nanosToIso('99999999999999999999999')).toBeNull()
    expect(nanosToIso(1e30)).toBeNull()
    expect(microsToNanos('1792396800123456')).toBe('1792396800123456000')
  })

  it('writes canonical JSON whatever the key order', () => {
    expect(canonical({ b: 1, a: { d: [2, { f: 1, e: 0 }], c: null } })).toBe(
      canonical({ a: { c: null, d: [2, { e: 0, f: 1 }] }, b: 1 }),
    )
  })
})
