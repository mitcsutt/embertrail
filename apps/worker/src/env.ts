/**
 * The Worker's bindings. `wrangler.jsonc` and `wrangler types` must agree with this; the
 * optional ones are vars or secrets a deployment sets (docs/cloudflare.md lists each).
 */
export interface WorkerEnv {
  /** The Hyperdrive config for Postgres, created with caching disabled. */
  HYPERDRIVE: Hyperdrive
  /** The Dashboard's `dist/`, served by Workers Static Assets. */
  ASSETS: Fetcher
  /** Secret, at least 32 characters. Unsetting it after bootstrap is fine. */
  BOOTSTRAP_TOKEN?: string
  /** Var: `<team>.cloudflareaccess.com`. */
  ACCESS_TEAM_DOMAIN?: string
  /** Var: the Access application's AUD tag. */
  ACCESS_AUD?: string
  /** Var, comma-separated. Empty for a solo Hub. */
  ALLOWED_EMAILS?: string
  /** Var, comma-separated. Empty for a solo Hub. */
  ALLOWED_DOMAINS?: string
  /** Var. Unset keeps rows forever. */
  RETENTION_DAYS?: string
}
