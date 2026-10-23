import { expect, test } from '@playwright/test'

import { origin } from './origins.ts'

test('a Hub that is not running names the address and how to fix it', async ({ browser }) => {
  const dashboard = origin('E2E_ORIGIN_UNREACHABLE')
  const page = await browser.newPage({ baseURL: dashboard })
  await page.goto('/')
  await expect(page.getByText(`Can't reach the Hub at ${dashboard}`)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  await page.close()
})

test('a Token the Hub refuses names the address and the 401', async ({ browser }) => {
  const dashboard = origin('E2E_ORIGIN_UNAUTHORIZED')
  const page = await browser.newPage({ baseURL: dashboard })
  await page.goto('/')
  await expect(page.getByText(`The Hub at ${dashboard} rejected the request (401)`)).toBeVisible()
  await page.close()
})
