// Bundles the CLI into dist/bin.js. The private workspace packages (the Hub, its Modules, the
// Docker server and the client) are bundled in, so the published package holds plain
// JavaScript; only the Postgres driver is left to npm.

import { build } from 'esbuild'

await build({
  entryPoints: ['src/bin.ts'],
  outfile: 'dist/bin.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  external: ['pg', 'pg-native'],
  legalComments: 'none',
  logLevel: 'info',
})
