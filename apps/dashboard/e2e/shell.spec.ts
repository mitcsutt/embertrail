import { expect, test } from '@playwright/test'

import { expectNoAxeViolations } from './axe.ts'
import { origin } from './origins.ts'

test.use({ baseURL: origin('E2E_ORIGIN') })

test('the shell loads and shows who the Hub says is signed in', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/boards\/overview$/)
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
  await expect(page.getByText('Signed in as dashboard')).toBeVisible()
})

test('the shell has no axe violations in light and dark', async ({ page }) => {
  await page.goto('/')
  const signedIn = page.getByText('Signed in as dashboard')
  await expect(signedIn).toBeVisible()
  await expectNoAxeViolations(page, signedIn)
})
