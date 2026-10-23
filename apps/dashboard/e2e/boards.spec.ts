import { expect, test } from '@playwright/test'

import { expectNoAxeViolations } from './axe.ts'
import { origin } from './origins.ts'

test.use({ baseURL: origin('E2E_ORIGIN') })

// #42 AC5: every Widget of the Catalogue passes axe in light and dark. Everything holds them all.
for (const board of ['overview', 'everything']) {
  test(`the ${board} Board has no axe violations in light and dark`, async ({ page }) => {
    // Loads every Widget and reloads per theme; parallel workers slow the Hub's queries.
    test.slow()
    await page.goto(`/boards/${board}`)
    const heading = page.getByRole('heading', { level: 1 })
    await expect(heading).toBeVisible()
    // Axe must see the drawn Widgets, not their loading frames.
    await expectNoAxeViolations(page, heading, async () => {
      await expect(page.getByRole('group').first()).toBeVisible()
      await expect(page.getByText(/loading/i)).toHaveCount(0)
    })
  })
}
