import { expect, type Page, test } from '@playwright/test'
import { gotoApp } from './helpers'

const FP1 = '/replay?s=2026/10-spa-francorchamps/fp1'
const scene = (page: Page) =>
  page.evaluate(() => ({ ...window.__trazada!.scene })) as Promise<NonNullable<Window['__trazada']>['scene']>

async function openScene(page: Page) {
  await gotoApp(page, FP1)
  await expect.poll(async () => (await page.evaluate(() => window.__trazada?.scene.ready)) ?? false, { timeout: 15_000 }).toBe(true)
}

test('circuito: pit lane a ±10 % de las muestras y exageración marcada como Estimado', async ({ page }) => {
  await openScene(page)
  const s = await scene(page)
  expect(s.pitLaneLengthM).toBeGreaterThan(0)
  expect(Math.abs(s.pitLaneLengthM - s.pitSamplesLengthM) / s.pitSamplesLengthM).toBeLessThanOrEqual(0.1)

  await expect(page.getByTestId('elevation-1')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('estimated')).toHaveCount(0)
  const renders = await page.evaluate(() => window.__trazada!.renders)
  await page.getByTestId('elevation-3').click()
  await expect(page.getByTestId('estimated')).toBeVisible()
  await expect(page.getByTestId('estimated')).toContainText('×3')
  await expect.poll(() => page.evaluate(() => window.__trazada!.renders)).toBeGreaterThan(renders)
  expect((await scene(page)).elevationScale).toBe(3)

  // La preferencia se recuerda al recargar.
  await openScene(page)
  await expect(page.getByTestId('elevation-3')).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('elevation-1').click()
  await expect(page.getByTestId('estimated')).toHaveCount(0)
})

test('captura del circuito de Spa con cámara fija @screenshot', async ({ page }) => {
  // Las referencias se generan en el contenedor de CI (workflow "Snapshots"); otro Chromium da píxeles distintos.
  test.skip(!process.env.CI, 'las capturas de referencia solo se comparan en CI')
  test.skip(process.env.SKIP_SCREENSHOTS === 'true', 'el workflow Snapshots está regenerando las referencias')
  await page.addInitScript(() => localStorage.clear())
  await openScene(page)
  await page.mouse.move(0, 0)
  // Solo el lienzo: se oculta la interfaz superpuesta (y el chip con el tiempo de carga, que varía).
  await page.addStyleTag({
    content:
      '.tz-replay__bar, .tz-replay__side, [data-testid="replay-dock"], [data-testid="scene-tools"], [data-testid="leaderboard"], .tz-labels, .tz-cars { visibility: hidden !important; }',
  })
  await expect(page.locator('[data-testid="scene"] canvas')).toHaveScreenshot('spa.png', { maxDiffPixelRatio: 0.01 })
})
