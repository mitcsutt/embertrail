import { z } from 'zod'

/** The Hub's address, empty for the page's own origin, or an absolute http(s) URL. */
const hubUrl = z
  .string()
  .refine((value) => value === '' || /^https?:\/\/[^\s/]/i.test(value), {
    message: 'must be "" (this page\'s own origin) or an http:// or https:// URL',
  })
  .transform((value) => value.replace(/\/+$/, ''))

const schema = z.strictObject({
  hubUrl,
  headers: z.record(z.string(), z.string()).optional(),
})

/** What `config.json` holds (#72 A3). Swap the file to point the Dashboard at another Hub; no rebuild. */
export type RuntimeConfig = z.output<typeof schema>

/** `config.json` could not be loaded or is not valid. The message says what and why. */
export class RuntimeConfigError extends Error {
  override readonly name = 'RuntimeConfigError'
}

/** Checks a parsed `config.json`, naming each field that is wrong. */
export function parseRuntimeConfig(value: unknown): RuntimeConfig {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  const problems = result.error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : 'the file'} ${issue.message}`)
    .join('; ')
  throw new RuntimeConfigError(`config.json is not valid: ${problems}.`)
}

/**
 * Reads the app's own `config.json`, uncached so a reload picks up an edited file. It is the
 * one request the Dashboard makes that does not go through the client: it has to be read
 * before the client exists.
 */
export async function loadRuntimeConfig(
  url = `${import.meta.env.BASE_URL}config.json`,
): Promise<RuntimeConfig> {
  let response: Response
  try {
    // eslint-disable-next-line no-restricted-globals -- the app's own static file, read before the client exists
    response = await fetch(url, { cache: 'no-store' })
  } catch (error) {
    throw new RuntimeConfigError(
      `Can't load ${url}: ${error instanceof Error ? error.message : String(error)}.`,
    )
  }
  if (!response.ok) {
    throw new RuntimeConfigError(
      `Can't load ${url}: the server answered ${String(response.status)}.`,
    )
  }
  let parsed: unknown
  try {
    parsed = await response.json()
  } catch {
    throw new RuntimeConfigError(`config.json is not valid JSON.`)
  }
  return parseRuntimeConfig(parsed)
}
