import { createFileRoute } from '@tanstack/react-router'

import { SessionGroupsPage } from '#features/sessions/pages/SessionGroupsPage'

export const Route = createFileRoute('/sessions/')({
  component: SessionGroupsPage,
})
