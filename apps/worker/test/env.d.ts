// Bindings that only `vitest.config.ts` adds, so the generated worker-configuration.d.ts lacks them.
declare namespace Cloudflare {
  interface Env {
    POSTGRES_AVAILABLE: string
    RUNNING_IN_CI: string
  }
}
