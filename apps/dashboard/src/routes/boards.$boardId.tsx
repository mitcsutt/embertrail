import { createFileRoute } from '@tanstack/react-router'

import { BoardPage } from '#features/boards/pages/BoardPage'

export const Route = createFileRoute('/boards/$boardId')({
  component: BoardPage,
})
