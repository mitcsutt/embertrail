import { Outlet, createRootRoute } from '@tanstack/react-router'

import { AppShell } from '#app/components/AppShell'

export const Route = createRootRoute({
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
})
