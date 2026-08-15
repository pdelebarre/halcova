import { test, expect } from '@playwright/test'

test('app-load-auth-screen', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173')
  await expect(page.getByText('Halcova').first()).toBeVisible()
  await page.getByRole('button', { name: 'Request access' }).click()
  await expect(page.getByText('Request access to start cataloging.').first()).toBeVisible()
})
