// Bundles the server into dist/server.js for the Docker image. The private workspace packages
// are bundled in; only the Postgres driver is left to npm, as in the CLI's build.

import { build } from 'esbuild'

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  external: ['pg', 'pg-native'],
  legalComments: 'none',
  logLevel: 'info',
})
