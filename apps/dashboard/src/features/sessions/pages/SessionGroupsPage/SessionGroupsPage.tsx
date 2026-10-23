import { Container, Heading, Stack, Text } from '@mitcsutt/kiln-ui'

/** Placeholder until the Session Group view lands (#72 D11). */
export function SessionGroupsPage() {
  return (
    <Container width="full">
      <Stack gap={3}>
        <Heading level={1}>Session Groups</Heading>
        <Text tone="muted">Session Groups arrive with their view.</Text>
      </Stack>
    </Container>
  )
}
