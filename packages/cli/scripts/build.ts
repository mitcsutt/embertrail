// Bundles the CLI into dist/bin.js. The private workspace packages (the Hub, its Modules, the
// Docker server and the client) are bundled in, so the published package holds plain
// JavaScript; only the Postgres driver is left to npm. `?raw` imports (the local stack's
// compose.yaml) are bundled as text.

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

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
  // CommonJS dependencies (yaml's Node build) call require, which an ES module lacks.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  logLevel: 'info',
  plugins: [
    {
      name: 'raw',
      setup(plugin) {
        plugin.onResolve({ filter: /\?raw$/ }, (args) => ({
          path: resolve(args.resolveDir, args.path.replace(/\?raw$/, '')),
          namespace: 'raw',
        }))
        plugin.onLoad({ filter: /.*/, namespace: 'raw' }, async (args) => ({
          contents: await readFile(args.path, 'utf8'),
          loader: 'text',
        }))
      },
    },
  ],
})
