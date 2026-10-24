import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

import { databaseUrl, scratchDatabase, urlFor } from './test/postgres'

// pg-protocol is a dependency of pg, so it resolves from pg's own location.
const pgRequire = createRequire(createRequire(import.meta.url).resolve('pg'))

// With DATABASE_URL set, the Hyperdrive binding's local connection string is a scratch
// database that `test/global-setup.ts` creates and drops. Hyperdrive in workerd forwards to
// it, so the Db Adapter is tested on the same `env.HYPERDRIVE.connectionString` it uses.
if (databaseUrl !== '') {
  process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE = urlFor(scratchDatabase)
}

export default defineConfig({
  // Vitest resolves pg's dependencies with the wrong export conditions (the ESM build of
  // pg-protocol for a require, the empty socket of pg-cloudflare without `workerd`), so point
  // them at the CommonJS builds that work. A real build (wrangler) resolves them correctly.
  resolve: {
    alias: {
      'pg-protocol': pgRequire.resolve('pg-protocol/dist/index.js'),
      'pg-cloudflare': resolve(
        dirname(pgRequire.resolve('pg-cloudflare/package.json')),
        'dist/index.js',
      ),
    },
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        assets: {
          directory: resolve(import.meta.dirname, 'test/assets'),
          binding: 'ASSETS',
        },
        // workerd cannot see DATABASE_URL, so it learns only whether the database tests can run.
        bindings: {
          POSTGRES_AVAILABLE: databaseUrl === '' ? '' : 'yes',
          RUNNING_IN_CI: process.env.CI === undefined ? '' : 'yes',
        },
      },
    }),
  ],
  test: {
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 30_000,
  },
})
