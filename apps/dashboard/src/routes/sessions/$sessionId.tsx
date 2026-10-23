import { createFileRoute } from '@tanstack/react-router'

import { SessionPage } from '#features/sessions/pages/SessionPage'

export const Route = createFileRoute('/sessions/$sessionId')({
  component: SessionPage,
})
