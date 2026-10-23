import { Container, Heading, Stack, Text } from '@mitcsutt/kiln-ui'
import { useParams } from '@tanstack/react-router'

/** Placeholder until the Board view lands (#72 D6). */
export function BoardPage() {
  const { boardId } = useParams({ from: '/boards/$boardId' })
  return (
    <Container width="full">
      <Stack gap={3}>
        <Heading level={1}>Board: {boardId}</Heading>
        <Text tone="muted">Widgets arrive with the Board view.</Text>
      </Stack>
    </Container>
  )
}
