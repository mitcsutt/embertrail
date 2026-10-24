import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { origin } from './origins.ts'

test.use({ baseURL: origin('E2E_ORIGIN') })

// Customising draws a Board of a dozen Widgets from the one Hub the specs share, and each test
// does so more than once: allow for a loaded runner.
test.beforeEach(() => {
  test.slow()
})

interface Cell {
  i: string
  x: number
  y: number
  w: number
  h: number
}

/** Customises the Overview and returns the new Board's id, with the editor open. */
async function customiseOverview(page: Page): Promise<string> {
  await page.goto('/boards/overview')
  await page.getByRole('button', { name: 'Customise' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Edit Board' })).toBeVisible()
  const match = /\/boards\/(b-[a-z0-9]+)/.exec(page.url())
  if (match?.[1] === undefined) throw new Error(`Not a stored Board: ${page.url()}`)
  await expect(page.getByRole('button', { name: /Move Top sessions/ })).toBeVisible()
  return match[1]
}

/** The Layout the Hub holds for a Board, read through the Dashboard's own proxy. */
async function storedLayout(page: Page, id: string): Promise<Cell[]> {
  const response = await page.request.get(`/api/v1/store/embertrail-dashboard/${id}`)
  expect(response.ok()).toBe(true)
  const document = (await response.json()) as { data: { layout: Cell[] } }
  return document.data.layout
}

const cellOf = (layout: Cell[], id: string): Cell => {
  const found = layout.find((cell) => cell.i === id)
  if (found === undefined) throw new Error(`No cell ${id}`)
  return found
}

/** A pointer drag in steps, so the drag engine sees the movement and not only the ends. */
async function drag(page: Page, from: Locator, by: { x: number; y: number }) {
  const box = await from.boundingBox()
  if (box === null) throw new Error('Nothing to drag')
  const startX = box.x + box.width / 2
  const startY = box.y + box.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  const steps = 12
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(startX + (by.x * step) / steps, startY + (by.y * step) / steps)
  }
  await page.mouse.up()
}

test('a Board is customised, rearranged by pointer, saved, and still arranged after a reload', async ({
  page,
}) => {
  const id = await customiseOverview(page)
  const before = await storedLayout(page, id)

  await drag(page, page.getByRole('button', { name: /Move Top sessions/ }), { x: 360, y: 0 })
  await drag(page, page.locator('[data-kiln-dnd-resize]').first(), { x: 120, y: 80 })
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible()

  const saved = await storedLayout(page, id)
  expect(cellOf(saved, 'top-sessions')).not.toEqual(cellOf(before, 'top-sessions'))

  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Overview (copy)' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible()
  expect(await storedLayout(page, id)).toEqual(saved)
})

test('a keyboard move is saved too', async ({ page }) => {
  const id = await customiseOverview(page)
  const before = await storedLayout(page, id)

  const handle = page.getByRole('button', { name: /Move Top sessions/ })
  await handle.focus()
  await page.keyboard.press('Space')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('Space')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible()

  const saved = await storedLayout(page, id)
  expect(cellOf(saved, 'top-sessions')).not.toEqual(cellOf(before, 'top-sessions'))
  expect(cellOf(saved, 'top-sessions').w).toBe(cellOf(before, 'top-sessions').w + 1)
})

test('Overview is unchanged by customising it, and a save that lost to another is not lost silently', async ({
  page,
}) => {
  const id = await customiseOverview(page)
  await expect(page.getByRole('heading', { level: 1, name: 'Edit Board' })).toBeVisible()

  // Someone else saves the Board first.
  const current = await page.request.get(`/api/v1/store/embertrail-dashboard/${id}`)
  const { data } = (await current.json()) as { data: Record<string, unknown> }
  const overwrite = await page.request.put(`/api/v1/store/embertrail-dashboard/${id}`, {
    data: { data: { ...data, name: 'Renamed elsewhere' } },
  })
  expect(overwrite.ok()).toBe(true)

  await page.getByRole('textbox', { name: 'Board name' }).fill('My rename')
  await page.getByRole('button', { name: 'Save' }).click()
  const dialog = page.getByRole('dialog', { name: 'This Board changed elsewhere' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Reload' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Renamed elsewhere' })).toBeVisible()

  await page.goto('/boards/overview')
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible()
})

test('the Model mix legend stays inside its card at the smallest size the grid allows', async ({
  page,
}) => {
  await customiseOverview(page)
  const card = page.getByRole('group', { name: 'Model mix' })
  const legend = card.locator('[class*="kiln-Share__legend"]')
  await expect(legend).toBeVisible()

  const handle = page.getByRole('button', { name: /Move Model mix/ })
  await handle.focus()
  await page.keyboard.press('Space')
  // Down to the Widget's minimum size, 3 × 4, and more presses to prove the grid stops there.
  for (let step = 0; step < 3; step += 1) {
    await page.keyboard.press('Shift+ArrowUp')
    await page.keyboard.press('Shift+ArrowLeft')
  }
  await page.keyboard.press('Space')

  // The legend may be longer than the card, but only inside a box that clips it to the card.
  const spill = await legend.evaluate((element) => {
    const card = element.closest('[role="group"]')
    if (card === null) throw new Error('The legend is not in a card')
    let clip: Element = element
    for (let at = element.parentElement; at !== null && at !== card; at = at.parentElement) {
      if (getComputedStyle(at).overflowY !== 'visible') {
        clip = at
        break
      }
    }
    const inside = clip.getBoundingClientRect()
    const outer = card.getBoundingClientRect()
    return Math.max(inside.bottom - outer.bottom, inside.right - outer.right)
  })
  expect(spill).toBeLessThanOrEqual(0.5)
})
