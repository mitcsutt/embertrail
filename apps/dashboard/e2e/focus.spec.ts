import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import { modes, setMode } from './axe.ts'
import { origin } from './origins.ts'

test.use({ baseURL: origin('E2E_ORIGIN') })

// Each test customises a Board or reloads in two colour modes against the one shared Hub.
test.beforeEach(() => {
  test.slow()
})

/** What the focused element looks like: a ring (outline or shadow) on it or one of its wrappers. */
async function focusRing(page: Page): Promise<{ label: string; ring: boolean }> {
  return page.evaluate(() => {
    const active = document.activeElement
    if (active === null || active === document.body) return { label: 'body', ring: false }
    const drawsRing = (element: Element) => {
      const style = getComputedStyle(element)
      const outline = style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0
      return outline || style.boxShadow !== 'none'
    }
    let ring = false
    for (let element: Element | null = active, depth = 0; element && depth < 3; depth += 1) {
      ring ||= drawsRing(element)
      element = element.parentElement
    }
    const name = active.getAttribute('aria-label') ?? active.textContent.trim().slice(0, 40)
    return { label: `${active.tagName.toLowerCase()} "${name}"`, ring }
  })
}

/** Tabs through the next `stops` focusable elements and fails on one that shows no focus. */
async function expectVisibleFocusWhileTabbing(page: Page, stops: number, mode: string) {
  for (let stop = 0; stop < stops; stop += 1) {
    await page.keyboard.press('Tab')
    const { label, ring } = await focusRing(page)
    expect(ring, `stop ${stop}: ${label} shows no focus in ${mode} mode`).toBe(true)
  }
}

/** Waits until the Widgets have drawn: a loading frame is replaced, and takes focus with it. */
async function expectWidgetsDrawn(page: Page) {
  await expect(page.getByRole('group').first()).toBeVisible()
  await expect(page.getByText(/loading/i)).toHaveCount(0)
}

async function customiseOverview(page: Page) {
  await page.goto('/boards/overview')
  await page.getByRole('button', { name: 'Customise' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Edit Board' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Move Cost today/ })).toBeVisible()
  await expectWidgetsDrawn(page)
}

for (const mode of modes) {
  test(`focus is visible across a Board, edit mode and Session Groups in ${mode} mode`, async ({
    page,
  }) => {
    await page.goto('/boards/overview')
    await setMode(page, mode)
    await expect(page.getByRole('button', { name: 'Customise' })).toBeVisible()
    await expectWidgetsDrawn(page)
    await page.getByRole('link', { name: 'Everything' }).first().focus()
    await expectVisibleFocusWhileTabbing(page, 12, mode)

    await customiseOverview(page)
    await page.getByRole('textbox', { name: 'Board name' }).focus()
    await expectVisibleFocusWhileTabbing(page, 14, mode)
    await page.getByRole('button', { name: /Move Cost today/ }).focus()
    expect((await focusRing(page)).ring, `a drag handle shows no focus in ${mode} mode`).toBe(true)

    await page.getByRole('button', { name: 'Add Query Widget' }).click()
    await expect(page.getByRole('dialog', { name: 'Add a Query Widget' })).toBeVisible()
    await expectVisibleFocusWhileTabbing(page, 10, mode)
    await page.keyboard.press('Escape')

    await page.goto('/sessions?range=last-90-days')
    const tree = page.getByRole('treegrid', { name: 'Session Groups' })
    await expect(tree).toBeVisible()
    await tree.getByRole('row', { name: /billing-migration/ }).focus()
    expect((await focusRing(page)).ring, `a tree row shows no focus in ${mode} mode`).toBe(true)
  })
}

test('focus returns to what opened a Sheet or Dialog when it closes', async ({ page }) => {
  await customiseOverview(page)

  const returnsTo = async (opener: string, close: () => Promise<void>, dialog: RegExp) => {
    const button = page.getByRole('button', { name: opener, exact: true })
    await button.click()
    await expect(page.getByRole('dialog', { name: dialog })).toBeVisible()
    await close()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(button, `${opener} should have focus after closing`).toBeFocused()
  }
  const escape = () => page.keyboard.press('Escape')

  await returnsTo('Add Widget', escape, /Add a Widget/)
  await returnsTo('Add Query Widget', escape, /Query Widget/)
  await returnsTo('Add section', escape, /Add a section/)
  await returnsTo(
    'Add section',
    () => page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click(),
    /Add a section/,
  )
  await returnsTo(
    'Delete Board',
    () => page.getByRole('dialog').getByRole('button', { name: 'Keep it' }).click(),
    /Delete this Board/,
  )
})

const changeElsewhere = async (page: Page) => {
  await customiseOverview(page)
  const id = /\/boards\/(b-[a-z0-9]+)/.exec(page.url())?.[1]
  if (id === undefined) throw new Error(`Not a stored Board: ${page.url()}`)
  const current = await page.request.get(`/api/v1/store/embertrail-dashboard/${id}`)
  const { data } = (await current.json()) as { data: Record<string, unknown> }
  await page.request.put(`/api/v1/store/embertrail-dashboard/${id}`, {
    data: { data: { ...data, name: 'Renamed elsewhere' } },
  })
}

test('focus returns to Save after Keep editing on the conflict dialog', async ({ page }) => {
  await changeElsewhere(page)

  await page.getByRole('textbox', { name: 'Board name' }).fill('My rename')
  const save = page.getByRole('button', { name: 'Save' })
  await save.click()
  const dialog = page.getByRole('dialog', { name: 'This Board changed elsewhere' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Keep editing' }).click()
  await expect(dialog).toBeHidden()
  await expect(save).toBeFocused()
})

test('focus returns to Delete Board after Keep editing on a delete conflict', async ({ page }) => {
  await changeElsewhere(page)

  const toolbarDelete = page.getByRole('button', { name: 'Delete Board' })
  await toolbarDelete.click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete Board' }).click()
  const dialog = page.getByRole('dialog', { name: 'This Board changed elsewhere' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Keep editing' }).click()
  await expect(dialog).toBeHidden()
  await expect(toolbarDelete).toBeFocused()
})
