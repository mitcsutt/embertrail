import AxeBuilder from '@axe-core/playwright'
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

// Where the Dashboard keeps the colour mode (the Vite config's theme script reads the same key).
const modeKey = 'embertrail-dashboard-mode'
export const modes = ['light', 'dark'] as const

/** Stores a colour mode and reloads the page into it. */
export async function setMode(page: Page, mode: (typeof modes)[number]): Promise<void> {
  await page.evaluate(
    ({ key, value }) => {
      localStorage.setItem(key, value)
    },
    { key: modeKey, value: mode },
  )
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-mode', mode)
}

/**
 * Checks the current page with axe in light and in dark mode and fails on any violation. It stores
 * each mode and reloads the page, so pass `ready`, a locator that is visible once the content you
 * want checked has rendered. Pass `settled` too when the page keeps loading after that, such as
 * a Board whose Widgets fetch their data: it runs after each reload, before axe.
 */
export async function expectNoAxeViolations(
  page: Page,
  ready: Locator,
  settled?: () => Promise<void>,
): Promise<void> {
  for (const mode of modes) {
    await setMode(page, mode)
    await expect(ready).toBeVisible()
    await settled?.()
    const { violations } = await new AxeBuilder({ page }).analyze()
    expect(violations, `axe violations in ${mode} mode`).toEqual([])
  }
}
