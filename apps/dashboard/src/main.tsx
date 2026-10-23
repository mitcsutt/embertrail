import '@mitcsutt/kiln-ui/styles.css'
import '@mitcsutt/kiln-charts/styles.css'
import '@mitcsutt/kiln-dnd/styles.css'

import { RouterProvider, createRouter } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { Providers } from '#app/components/Providers'
import { routeTree } from '#routeTree'

const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

const root = document.getElementById('root')
if (!root) throw new Error('index.html has no #root element')

createRoot(root).render(
  <StrictMode>
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  </StrictMode>,
)
