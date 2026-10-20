import { describe, expect, it } from 'vitest'

import { generateToken, hashSecret, parseToken, sameHash } from './tokens'

describe('Token format', () => {
  it('generates et_<id>_<secret> that parses back to its parts', () => {
    const generated = generateToken()
    expect(generated.token).toMatch(/^et_[a-z0-9]{16}_[A-Za-z0-9]{40}$/)
    expect(parseToken(generated.token)).toEqual({ id: generated.id, secret: generated.secret })
  })

  it('never repeats an id or a secret', () => {
    const many = Array.from({ length: 200 }, generateToken)
    expect(new Set(many.map((t) => t.id)).size).toBe(200)
    expect(new Set(many.map((t) => t.secret)).size).toBe(200)
  })

  it.each([
    ['empty', ''],
    ['no prefix', `${'a'.repeat(16)}_${'b'.repeat(40)}`],
    ['another prefix', `ek_${'a'.repeat(16)}_${'b'.repeat(40)}`],
    ['uppercase id', `et_${'A'.repeat(16)}_${'b'.repeat(40)}`],
    ['short id', `et_${'a'.repeat(15)}_${'b'.repeat(40)}`],
    ['short secret', `et_${'a'.repeat(16)}_${'b'.repeat(39)}`],
    ['long secret', `et_${'a'.repeat(16)}_${'b'.repeat(41)}`],
    ['symbol in secret', `et_${'a'.repeat(16)}_${'b'.repeat(39)}-`],
    ['whitespace', ` et_${'a'.repeat(16)}_${'b'.repeat(40)}`],
  ])('rejects a malformed Token: %s', (_, token) => {
    expect(parseToken(token)).toBeNull()
  })

  it('hashes a secret as lowercase hex SHA-256', async () => {
    // SHA-256("abc"), from FIPS 180-2.
    expect(await hashSecret('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('compares hashes', async () => {
    const hash = await hashSecret('one')
    expect(sameHash(hash, await hashSecret('one'))).toBe(true)
    expect(sameHash(hash, await hashSecret('two'))).toBe(false)
    expect(sameHash(hash, hash.slice(1))).toBe(false)
  })
})
