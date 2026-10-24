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

test('a click anywhere on a group row opens it, and Back from a Session returns to the open tree', async ({
  page,
}) => {
  await page.goto('/sessions?range=last-90-days')
  const tree = page.getByRole('treegrid', { name: 'Session Groups' })
  const group = tree.getByRole('row', { name: /billing-migration/ })

  // The Tokens cell, well away from the chevron.
  await group.getByRole('gridcell').last().click()
  await expect(group).toHaveAttribute('aria-expanded', 'true')
  await group.getByRole('gridcell').last().click()
  await expect(group).toHaveAttribute('aria-expanded', 'false')
  await group.getByRole('gridcell').last().click()

  // A click on a Session's row, not its link, opens the Session.
  await tree.locator('[aria-level="2"]').first().getByRole('gridcell').last().click()
  await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]+$/)
  await expect(page.getByRole('table')).toBeVisible()

  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page).toHaveURL(/\/sessions\?.*range=last-90-days/)
  await expect(tree.getByRole('row', { name: /billing-migration/ })).toHaveAttribute(
    'aria-expanded',
    'true',
  )
})

test('a Session opened directly links to the Session Groups', async ({ page }) => {
  await page.goto('/sessions?range=last-90-days')
  await page.getByRole('treegrid', { name: 'Session Groups' }).getByRole('row').nth(1).click()
  await page
    .getByRole('link', { name: /^[0-9a-f]{8}$/ })
    .first()
    .click()
  const direct = page.url()

  await page.goto('about:blank')
  await page.goto(direct)
  await expect(page.getByRole('heading', { level: 1, name: /^Session / })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Back' })).toHaveCount(0)
  await page.getByRole('link', { name: 'All Session Groups' }).click()
  await expect(page.getByRole('treegrid', { name: 'Session Groups' })).toBeVisible()
})
