/** Accesibilidad (axe-core, WCAG 2.1 A/AA): ninguna infracción seria o crítica. */
import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { gotoApp, resetStorage, settled } from './helpers'

const FP1 = '/replay?s=2026/10-spa-francorchamps/fp1'

async function serious(page: Page) {
  await settled(page)
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    // El lienzo WebGL es la representación visual; su contenido accesible son los paneles y las siglas.
    .exclude('[data-testid="scene"] canvas')
    .analyze()
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)
}

test('portada y selector', async ({ page }) => {
  await gotoApp(page, '/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  expect(await serious(page)).toEqual([])
})

test('replay listo, con telemetría, dirección de carrera y etiquetas Estimado', async ({ page }) => {
  await resetStorage(page)
  await gotoApp(page, FP1)
  await expect.poll(async () => (await page.evaluate(() => window.__trazada?.scene.ready)) ?? false, { timeout: 15_000 }).toBe(true)
  // Al final de la sesión: el feed de dirección de carrera está lleno (región con scroll).
  await page.evaluate(() => window.__trazada!.seek(window.__trazada!.endMs - 1000))
  await page.locator('[data-testid="leaderboard"] [data-car]').first().getByRole('button').click()
  await page.getByTestId('elevation-2').click()
  await expect(page.getByTestId('telemetry')).toBeVisible()
  expect(await serious(page)).toEqual([])
  // Y en tablet vertical (paneles en la franja inferior).
  await page.setViewportSize({ width: 768, height: 1024 })
  await page.waitForTimeout(300)
  expect(await serious(page)).toEqual([])
})

test('estado de error y versión en inglés', async ({ page }) => {
  await gotoApp(page, '/replay?s=2026/10-spa-francorchamps/race')
  await expect(page.locator('[data-state="error"]').first()).toBeVisible({ timeout: 15_000 })
  expect(await serious(page)).toEqual([])
  const lang = await page.evaluate(() => document.documentElement.lang)
  await page.getByRole('button', { name: lang.startsWith('es') ? /English|inglés/i : /Spanish|español/i }).click()
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).not.toBe(lang)
  expect(await serious(page)).toEqual([])
})
