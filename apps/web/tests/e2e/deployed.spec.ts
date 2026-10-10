/**
 * Smoke post-deploy: el deep link a una sesión publicada se carga y se pinta en la app desplegada.
 * Solo con E2E_DEPLOYED_URL (y E2E_DEPLOYED_SESSION, que da scripts/smoke-deploy.sh).
 */
import { expect, test } from '@playwright/test'

const BASE = process.env.E2E_DEPLOYED_URL
const SESSION = process.env.E2E_DEPLOYED_SESSION
test.skip(!BASE || !SESSION, 'solo tras un deploy (E2E_DEPLOYED_URL y E2E_DEPLOYED_SESSION)')

test('deep link /replay?s=…: datos listos y escena pintada', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${BASE!.replace(/\/$/, '')}/replay?s=${SESSION}`)
  await expect(page.getByTestId('replay-status')).toHaveAttribute('data-state', 'ready', { timeout: 30_000 })
  await expect.poll(async () => (await page.evaluate(() => window.__trazada?.scene.ready)) ?? false, { timeout: 30_000 }).toBe(true)
  expect(await page.evaluate(() => window.__trazada!.renders)).toBeGreaterThan(0)
  expect(await page.evaluate(() => window.__trazada!.scene.instances)).toBeGreaterThan(0)
  expect(errors).toEqual([])
})
