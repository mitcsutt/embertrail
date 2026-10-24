import type { WorkerEnv } from './env'

/** The Hub on the Cloudflare Platform. It answers 501 until the Hub is wired in (#38). */
export default {
  fetch() {
    return new Response('Not implemented', { status: 501 })
  },
  scheduled() {
    // Retention runs here once the Hub is wired in.
  },
} satisfies ExportedHandler<WorkerEnv>
