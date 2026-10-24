import {
  Box,
  Container,
  IconButton,
  Inline,
  AppShell as KilnAppShell,
  MenuIcon,
  ModeToggle,
  Sheet,
  Text,
} from '@mitcsutt/kiln-ui'
import { useState, type ReactNode } from 'react'

import { JumpPalette } from '#app/components/JumpPalette'
import { SideNav } from '#app/components/SideNav'
import { LocaleSettings } from '#features/locale/components/LocaleSettings'
import { MoneyNote } from '#features/locale/components/MoneyNote'

import styles from './AppShell.module.css'

/**
 * One navigation model: the sidebar (`SideNav`) from `md` up, and the same list in a Sheet behind
 * the header's menu button below it. The header holds only the name, the jump palette, the locale
 * settings and the colour mode. Main pads every page the same, so pages set no outer space of their own.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <KilnAppShell navBreakpoint="md" className={styles.shell}>
      <KilnAppShell.Header>
        <Container width="full">
          <Inline justify="between" gap={3} wrap={false}>
            <Inline gap={2} wrap={false}>
              <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
                <Sheet.Trigger asChild>
                  <IconButton
                    label="Menu"
                    icon={<MenuIcon />}
                    variant="ghost"
                    tone="neutral"
                    size="sm"
                    hideAbove="md"
                  />
                </Sheet.Trigger>
                <Sheet.Content
                  side="left"
                  size="sm"
                  title="Embertrail"
                  onClick={(event) => {
                    // Following a link closes the menu, even one to the page already open.
                    if (event.target instanceof Element && event.target.closest('a') !== null) {
                      setMenuOpen(false)
                    }
                  }}
                >
                  <SideNav />
                </Sheet.Content>
              </Sheet>
              <Text weight="strong">Embertrail</Text>
            </Inline>
            <Inline gap={2} wrap={false}>
              <JumpPalette />
              <LocaleSettings />
              <ModeToggle />
            </Inline>
          </Inline>
        </Container>
      </KilnAppShell.Header>
      <KilnAppShell.Sidebar>
        <SideNav />
      </KilnAppShell.Sidebar>
      <KilnAppShell.Main>
        <MoneyNote />
        <Box paddingY={{ base: 4, md: 5 }}>{children}</Box>
      </KilnAppShell.Main>
    </KilnAppShell>
  )
}
