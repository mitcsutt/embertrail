import { mkdirSync } from 'node:fs'
import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

// wrangler.jsonc points assets at the Dashboard's dist/, which tests do not build; the plugin
// resolves the directory, so an empty one is enough.
mkdirSync(new URL('../dashboard/dist', import.meta.url), { recursive: true })

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
})
