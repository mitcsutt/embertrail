import type { HubConfig } from '@mitcsutt/embertrail-hub'
import { z } from 'zod'

import type { WorkerEnv } from './env'

const list = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '')

/** What the Worker reads from its bindings. The Hub's own schema validates the rest at boot. */
const envSchema = z.object({
  BOOTSTRAP_TOKEN: z.string().min(1).optional(),
  ACCESS_TEAM_DOMAIN: z.string().min(1).optional(),
  ACCESS_AUD: z.string().min(1).optional(),
  ALLOWED_EMAILS: z.string().default('').transform(list),
  ALLOWED_DOMAINS: z.string().default('').transform(list),
  RETENTION_DAYS: z.coerce.number().int().positive().optional(),
})

export interface WorkerConfig {
  /** The Hub's own config; the core validates it again at boot. */
  hub: HubConfig
  /** Set, the Hub trusts Cloudflare Access assertions; null means Tokens only. */
  access: { teamDomain: string; audience: string } | null
}

const bindingNames = new Set<string>(Object.keys(envSchema.shape))

/**
 * Reads the Worker's config from its bindings. An empty binding counts as unset. Throws one
 * error naming every bad binding. Access needs both `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`; one
 * alone is a mistake rather than a Tokens-only Hub.
 */
export function readWorkerConfig(env: WorkerEnv): WorkerConfig {
  const present = Object.fromEntries(
    Object.entries(env).filter(([key, value]) => bindingNames.has(key) && value !== ''),
  )
  const parsed = envSchema.safeParse(present)
  const problems = parsed.success
    ? []
    : parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
  if ('ACCESS_TEAM_DOMAIN' in present !== 'ACCESS_AUD' in present) {
    problems.push(
      'ACCESS_TEAM_DOMAIN and ACCESS_AUD: set both to use Cloudflare Access, or neither',
    )
  }
  if (!parsed.success || problems.length > 0) {
    throw new Error(`Invalid bindings:\n  ${problems.join('\n  ')}`)
  }
  const e = parsed.data
  return {
    hub: {
      allowedEmails: e.ALLOWED_EMAILS,
      allowedDomains: e.ALLOWED_DOMAINS,
      ...(e.BOOTSTRAP_TOKEN === undefined ? {} : { bootstrapToken: e.BOOTSTRAP_TOKEN }),
      ...(e.RETENTION_DAYS === undefined ? {} : { retentionDays: e.RETENTION_DAYS }),
    },
    access:
      e.ACCESS_TEAM_DOMAIN === undefined || e.ACCESS_AUD === undefined
        ? null
        : { teamDomain: e.ACCESS_TEAM_DOMAIN, audience: e.ACCESS_AUD },
  }
}
