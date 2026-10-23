import {
  AppShell as KilnAppShell,
  Container,
  Inline,
  ModeToggle,
  NavLinks,
  Text,
} from '@mitcsutt/kiln-ui'
import { Link, useRouterState } from '@tanstack/react-router'
import type { ReactNode } from 'react'

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const onSessions = pathname.startsWith('/sessions')

  return (
    <KilnAppShell>
      <KilnAppShell.Header>
        <Container width="full">
          <Inline justify="between">
            <Inline gap={5}>
              <Text weight="strong">Embertrail</Text>
              <NavLinks label="Main" size="sm">
                <NavLinks.Item asChild active={!onSessions}>
                  <Link to="/boards/$boardId" params={{ boardId: 'overview' }}>
                    Boards
                  </Link>
                </NavLinks.Item>
                <NavLinks.Item asChild active={onSessions}>
                  <Link to="/sessions">Session Groups</Link>
                </NavLinks.Item>
              </NavLinks>
            </Inline>
            <ModeToggle />
          </Inline>
        </Container>
      </KilnAppShell.Header>
      <KilnAppShell.Main>{children}</KilnAppShell.Main>
    </KilnAppShell>
  )
}
