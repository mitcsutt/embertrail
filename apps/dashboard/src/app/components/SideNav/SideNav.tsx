import { Box, NavLinks, Stack, Text } from '@mitcsutt/kiln-ui'
import { Link, useRouterState } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { BoardNav } from '#app/components/BoardNav'
import { useSelf } from '#lib/hub'

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack gap={1}>
      <Box paddingX={3}>
        <Text size="xs" tone="muted" weight="medium">
          {title}
        </Text>
      </Box>
      {children}
    </Stack>
  )
}

/**
 * The Dashboard's one navigation: the Boards, then the Session Groups page, then who is signed in.
 * The sidebar shows it from `md` up and the header's menu opens it in a Sheet below that.
 */
export function SideNav() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const { self } = useSelf()

  return (
    <Stack gap={5}>
      <Group title="Boards">
        <BoardNav />
      </Group>
      <Group title="Sessions">
        <NavLinks label="Sessions" orientation="vertical" size="sm">
          <NavLinks.Item asChild active={pathname.startsWith('/sessions')}>
            <Link to="/sessions">Session Groups</Link>
          </NavLinks.Item>
        </NavLinks>
      </Group>
      {self === undefined ? null : (
        <Box paddingX={3}>
          <Text size="xs" tone="muted">
            Signed in as {self.user.name}
          </Text>
        </Box>
      )}
    </Stack>
  )
}
