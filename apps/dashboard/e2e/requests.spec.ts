import { expect, test } from '@playwright/test'

import { origin } from './origins.ts'

const dashboard = origin('E2E_ORIGIN')

test.use({ baseURL: dashboard })

const foreignRequests = (requests: string[]) =>
  requests.filter((url) => !url.startsWith('data:') && new URL(url).origin !== dashboard)

// #40: the Dashboard sends no request except to the Hub, and the Hub's address is its own origin.
// Everything else is its own assets and config.json.
test('every request stays on the Dashboard origin and /api is the only API', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))

  await page.goto('/')
  await expect(page.getByText('Signed in as dashboard')).toBeVisible()
  await page.getByRole('link', { name: 'Session Groups' }).click()
  await expect(page.getByRole('heading', { name: 'Session Groups' })).toBeVisible()

  expect(requests.length).toBeGreaterThan(0)
  expect(foreignRequests(requests), 'requests that left the origin').toEqual([])
  const paths = requests
    .filter((url) => url.startsWith(dashboard))
    .map((url) => new URL(url).pathname)
  expect(paths).toContain('/config.json')
  expect(paths.filter((path) => path.startsWith('/api/'))).toContain('/api/v1/inventory')
})

test('the allowlist spec would catch a request that leaves the origin', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  await page.route('https://elsewhere.invalid/**', (route) => route.fulfill({ status: 204 }))

  await page.goto('/')
  await expect(page.getByText('Signed in as dashboard')).toBeVisible()
  await page.evaluate(() => fetch('https://elsewhere.invalid/leak').then(() => undefined))

  expect(foreignRequests(requests)).toEqual(['https://elsewhere.invalid/leak'])
})
