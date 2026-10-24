import { fileURLToPath } from 'node:url'
import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        assets: {
          directory: fileURLToPath(new URL('./test/assets', import.meta.url)),
          binding: 'ASSETS',
        },
      },
    }),
  ],
})
