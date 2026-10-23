import { themeScript } from '@mitcsutt/kiln-ui/theme-script'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
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
})
