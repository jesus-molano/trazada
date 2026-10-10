import { expect, test } from '@playwright/test'
import { gotoApp } from './helpers'

test('ninguna petición sale del origen de la app y los datos; / no pide GLB ni three.js', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin
  const requests: string[] = []
  page.on('request', (r) => requests.push(r.url()))

  await gotoApp(page, '/')
  await expect(page.getByTestId('season-2026')).toBeVisible()
  const onHome = [...requests]
  expect(onHome.filter((u) => u.endsWith('.glb'))).toEqual([])

  await page.getByTestId('event-spa-francorchamps').click()
  await page.getByTestId('session-fp1').click()
  await expect(page.getByTestId('replay-status')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('[data-testid="scene"] canvas')).toBeVisible()

  const foreign = requests.filter((u) => !u.startsWith('data:') && !u.startsWith('blob:') && new URL(u).origin !== origin)
  expect(foreign).toEqual([])
})
