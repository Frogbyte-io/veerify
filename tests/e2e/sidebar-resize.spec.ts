import { expect, test } from '@playwright/test'
import { loginViaProgrammaticPage } from './helpers/auth'

const TEST_EMAIL = process.env.E2E_USER_EMAIL || 'test@preview.local'
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD || 'password123'

test.describe('Sidebar resizing', () => {
  test('dragging the resize handle updates sidebar width', async ({ page }) => {
    await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
    await page.goto('/feedback')
    await expect(page).toHaveURL(/\/feedback/)

    const sidebar = page.locator('[data-testid="app-sidebar"]')
    const handle = page.locator('[data-testid="app-sidebar-resize-handle"]')

    await expect(sidebar).toBeVisible()
    await expect(handle).toBeVisible()

    const getSidebarWidth = async () =>
      sidebar.evaluate((element) => {
        const widthValue = getComputedStyle(element as HTMLElement).getPropertyValue('--sidebar-width')
        return Number.parseFloat(widthValue)
      })

    const initialWidth = await getSidebarWidth()
    const handleBox = await handle.boundingBox()
    expect(handleBox).not.toBeNull()

    const dragStartX = (handleBox?.x || 0) + (handleBox?.width || 0) / 2
    const dragY = (handleBox?.y || 0) + (handleBox?.height || 0) / 2

    await page.mouse.move(dragStartX, dragY)
    await page.mouse.down()
    await page.mouse.move(dragStartX + 96, dragY)
    await page.mouse.up()

    const resizedWidth = await getSidebarWidth()
    expect(resizedWidth).toBeGreaterThan(initialWidth)
  })
})
