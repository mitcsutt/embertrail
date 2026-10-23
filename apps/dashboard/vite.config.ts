import { processIo } from '@mitcsutt/embertrail-cli/io'
import { themeScript } from '@mitcsutt/kiln-ui/theme-script'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import { resolveHubProxy } from './scripts/hubProxy.ts'

export default defineConfig(async () => {
  const { target, headers } = await resolveHubProxy(processIo())
  const proxy = { '/api': { target, changeOrigin: true, headers } }
  console.log(
    `Proxying /api to ${target}${headers.authorization === undefined ? ' (no Token: run `embertrail login` or set EMBERTRAIL_TOKEN)' : ''}`,
  )
  return {
    server: { proxy },
    preview: { proxy },
    plugins: [
      tanstackRouter({ target: 'react', autoCodeSplitting: true }),
      react(),
      {
        // Sets the theme and colour mode before first paint. Keep the arguments in step with
        // ThemeProvider in src/app/components/Providers.
        name: 'embertrail-theme-script',
        transformIndexHtml: () => [
          {
            tag: 'script',
            children: themeScript('paper', 'system', { storageKey: 'embertrail-dashboard-mode' }),
            injectTo: 'head-prepend',
          },
        ],
      },
    ],
  }
})
