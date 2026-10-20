// Tokens (#29): opaque `et_<id>_<secret>`. The id finds the row; only the secret's SHA-256
// hash is stored, so the secret is shown once, when the Token is issued, and never again.

const idAlphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
const secretAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const idLength = 16
const secretLength = 40

const tokenPattern = /^et_([a-z0-9]{16})_([A-Za-z0-9]{40})$/

/** A uniformly random string over `alphabet`, by rejection sampling. */
function randomString(alphabet: string, length: number) {
  const limit = 256 - (256 % alphabet.length)
  let out = ''
  while (out.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (byte >= limit) continue
      out += alphabet.charAt(byte % alphabet.length)
      if (out.length === length) break
    }
  }
  return out
}

/** The parts of a well-formed Token. */
export interface ParsedToken {
  id: string
  secret: string
}

/** Splits a Token into its id and secret, or null when it isn't `et_<id>_<secret>`. */
export function parseToken(token: string): ParsedToken | null {
  const match = tokenPattern.exec(token)
  if (match?.[1] === undefined || match[2] === undefined) return null
  return { id: match[1], secret: match[2] }
}

/** A new Token. The caller stores `id` and `hashSecret(secret)`, and shows `token` once. */
export function generateToken(): ParsedToken & { token: string } {
  const id = randomString(idAlphabet, idLength)
  const secret = randomString(secretAlphabet, secretLength)
  return { id, secret, token: `et_${id}_${secret}` }
}

/** Lowercase hex SHA-256: what `core.tokens.secret_hash` holds. */
export async function hashSecret(secret: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Compares two hashes in time that doesn't depend on where they differ. */
export function sameHash(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
