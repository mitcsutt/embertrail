import { Container, Heading, Stack, Text } from '@mitcsutt/kiln-ui'
import { useParams } from '@tanstack/react-router'

/** Placeholder until the Session's Event timeline lands (#72 D11). */
export function SessionPage() {
  const { sessionId } = useParams({ from: '/sessions/$sessionId' })
  return (
    <Container width="full">
      <Stack gap={3}>
        <Heading level={1}>Session {sessionId}</Heading>
        <Text tone="muted">The Event timeline arrives with the Session Group view.</Text>
      </Stack>
    </Container>
  )
}
