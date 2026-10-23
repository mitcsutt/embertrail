import { expect, test } from '@playwright/test'

import { expectNoAxeViolations } from './axe.ts'
import { origin } from './origins.ts'

test.use({ baseURL: origin('E2E_ORIGIN') })

test('Session Groups open by keyboard to a Session and its Event timeline', async ({ page }) => {
  test.slow() // axe reloads the page once for each colour mode
  await page.goto('/sessions?range=last-90-days')
  const tree = page.getByRole('treegrid', { name: 'Session Groups' })
  await expect(tree).toBeVisible()
  // axe reloads the page, so it checks the tree before a row is opened.
  await expectNoAxeViolations(page, tree)
  const group = tree.getByRole('row', { name: /billing-migration/ })
  await expect(group).toHaveAttribute('aria-expanded', 'false')

  await group.focus()
  // The group, its orchestrator, and the orchestrator's subagents: three levels of Sessions.
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(group).toHaveAttribute('aria-expanded', 'true')
  await expect(tree.locator('[aria-level="3"]').first()).toBeVisible()

  await tree.locator('[aria-level="2"]').first().getByRole('link').click()
  await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]+$/)
  await expect(page.getByRole('heading', { level: 1, name: /^Session / })).toBeVisible()
  await expect(page.getByRole('table')).toBeVisible()
})
