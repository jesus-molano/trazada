import { expect, type Page, test } from '@playwright/test'
import { gotoApp, resetStorage } from './helpers'

const FP1 = '/replay?s=2026/10-spa-francorchamps/fp1'

async function open(page: Page) {
  await gotoApp(page, FP1)
  await expect.poll(async () => (await page.evaluate(() => window.__trazada?.scene.ready)) ?? false, { timeout: 15_000 }).toBe(true)
}

/** La etiqueta del campo es visible y está en el idioma de la página. */
async function expectLabel(page: Page, field: string) {
  const label = page.locator(`[data-testid="estimated"][data-field="${field}"]`)
  await expect(label).toBeVisible()
  const lang = await page.evaluate(() => document.documentElement.lang)
  await expect(label).toContainText(lang.startsWith('es') ? 'Estimado:' : 'Estimated:')
  await expect(label).toHaveAttribute('title', /.{20,}/) // con su explicación
}

test.beforeEach(async ({ page }) => {
  await resetStorage(page)
})

test('exageración de altura y separación visual: Estimado mientras están activas', async ({ page }) => {
  await open(page)
  await expect(page.getByTestId('estimated')).toHaveCount(0)
  await page.getByTestId('elevation-3').click()
  await expectLabel(page, 'elevation')
  await page.getByTestId('elevation-1').click()
  await expect(page.locator('[data-field="elevation"]')).toHaveCount(0)

  await page.getByTestId('toggle-separation').click()
  await expect(page.getByTestId('toggle-separation')).toHaveAttribute('aria-pressed', 'true')
  await expectLabel(page, 'separation')
  await page.getByTestId('toggle-separation').click()
  await expect(page.locator('[data-field="separation"]')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => window.__trazada!.separatedCars)).toBe(0)
})

test('campos que el manifest declara estimados: posiciones, telemetría y estado de pista', async ({ page }) => {
  // El manifest no va firmado (los ficheros sí): se le añaden campos estimados como haría el pipeline.
  await page.route('**/sessions/2026/10-spa-francorchamps/fp1/manifest.json', async (route) => {
    const res = await route.fetch()
    const manifest = await res.json()
    manifest.quality.estimated = ['positions', 'telemetry', 'trackStatus']
    await route.fulfill({ response: res, json: manifest })
  })
  await open(page)
  await expectLabel(page, 'positions')
  await expectLabel(page, 'trackStatus')
  await page.locator('[data-testid="leaderboard"] [data-car]').first().getByRole('button').click()
  await expectLabel(page, 'telemetry')
})

test('en inglés, la etiqueta también se traduce', async ({ page }) => {
  await open(page)
  const lang = await page.evaluate(() => document.documentElement.lang)
  await page.getByRole('button', { name: lang.startsWith('es') ? /English|inglés/i : /Spanish|español/i }).click()
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).not.toBe(lang)
  await page.getByTestId('elevation-2').click()
  await expectLabel(page, 'elevation')
})
