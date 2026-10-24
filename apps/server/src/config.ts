import type { HubConfig } from '@mitcsutt/embertrail-hub'
import { z } from 'zod'

const list = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '')

const count = z.coerce.number().int().positive()

/** What the Docker Platform reads from the environment (docs/self-hosting.md lists each). */
const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'is required: the Postgres connection string'),
  DATABASE_POOL_SIZE: count.default(10),
  // 0 asks the OS for a free port, which the tests use.
  PORT: z.coerce.number().int().min(0).max(65_535).default(8787),
  HOST: z.string().min(1).default('0.0.0.0'),
  BOOTSTRAP_TOKEN: z.string().min(1).optional(),
  ALLOWED_EMAILS: z.string().default('').transform(list),
  ALLOWED_DOMAINS: z.string().default('').transform(list),
  RETENTION_DAYS: count.optional(),
  /** `off` stops the Hub fetching exchange rates; it makes no other outbound request. */
  EXCHANGE_RATES: z.enum(['ecb', 'off']).default('ecb'),
  /** Where people reach the Hub, for the login command printed with the first Token. */
  PUBLIC_URL: z.url().optional(),
})

export interface ServerConfig {
  databaseUrl: string
  poolSize: number
  port: number
  host: string
  publicUrl: string | undefined
  /** Whether the Hub fetches the ECB's daily exchange rates. */
  exchangeRates: boolean
  /** The Hub's own config; the core validates it again at boot. */
  hub: HubConfig
}

/**
 * Reads the server's config from env. An empty variable counts as unset, since Compose passes
 * `FOO: ${FOO:-}` through as an empty string. Throws one error naming every bad variable.
 */
export function readConfig(env: Record<string, string | undefined>): ServerConfig {
  const present = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''))
  const parsed = envSchema.safeParse(present)
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
    throw new Error(`Invalid environment:\n  ${problems.join('\n  ')}`)
  }
  const e = parsed.data
  return {
    databaseUrl: e.DATABASE_URL,
    poolSize: e.DATABASE_POOL_SIZE,
    port: e.PORT,
    host: e.HOST,
    publicUrl: e.PUBLIC_URL,
    exchangeRates: e.EXCHANGE_RATES === 'ecb',
    hub: {
      allowedEmails: e.ALLOWED_EMAILS,
      allowedDomains: e.ALLOWED_DOMAINS,
      ...(e.BOOTSTRAP_TOKEN === undefined ? {} : { bootstrapToken: e.BOOTSTRAP_TOKEN }),
      ...(e.RETENTION_DAYS === undefined ? {} : { retentionDays: e.RETENTION_DAYS }),
    },
  }
}
