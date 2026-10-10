/**
 * Hoja de análisis (ítem 3, D33) con la carrera de Japón 2026 (datos completos de data/; fuente dev, nunca en un
 * fixture): el race trace con datos de carrera reales, «Sin spoilers» y la línea de la vuelta en curso. Solo en
 * local, con un servidor aparte:
 *   E2E_DATA_DIR=../../data node tests/e2e/serve.mjs --port 4199
 *   E2E_LOCAL_URL=http://127.0.0.1:4199 pnpm e2e local-analysis
 */
import { expect, type Page, test } from '@playwright/test'
import { markTipsSeen } from './helpers'

const BASE = process.env.E2E_LOCAL_URL
test.skip(!BASE, 'solo en local (E2E_LOCAL_URL con data/ servido)')

async function open(page: Page) {
  await markTipsSeen(page)
  await page.goto(`${BASE}/replay?s=2026/03-suzuka/race`)
  await page.waitForFunction(() => window.__trazada?.scene.ready, null, { timeout: 30_000 })
}

test('race trace hasta el reloj, con la línea de la vuelta en curso; sin «Sin spoilers», la carrera entera', async ({ page }) => {
  await open(page)
  const { startMs, endMs } = await page.evaluate(() => ({ startMs: window.__trazada!.startMs, endMs: window.__trazada!.endMs }))
  await page.evaluate((t) => window.__trazada!.seek(t), (startMs + endMs) / 2)
  await page.getByTestId('analysis-button').click()
  const sheet = page.getByTestId('analysis-sheet')
  await expect(sheet).toHaveAttribute('data-tab', 'raceTrace')
  expect(await page.evaluate(() => window.__trazada!.sceneHidden)).toBe(true)

  const chart = page.getByTestId('race-trace-chart')
  await expect(chart.locator('canvas')).toHaveCount(1)
  const upToNow = Number(await chart.getAttribute('data-points'))
  expect(upToNow).toBeGreaterThan(5)
  // La línea del instante actual, visible (la vuelta en curso del primero entra en el eje).
  await expect(chart.getByTestId('analysis-cursor')).toBeVisible()
  // Todas las series con su sigla en la leyenda.
  expect(await chart.getByTestId('analysis-legend-item').count()).toBeGreaterThanOrEqual(20)

  await page.getByTestId('analysis-spoilers').click()
  await expect.poll(async () => Number(await chart.getAttribute('data-points'))).toBeGreaterThan(upToNow)

  // Un clic en la gráfica salta al inicio de una vuelta.
  const before = await page.evaluate(() => window.__trazada!.timeMs)
  await chart.locator('.u-over').click({ position: { x: 20, y: 20 } })
  await expect.poll(() => page.evaluate(() => window.__trazada!.timeMs)).toBeLessThan(before)

  await page.getByTestId('analysis-tab-pace').click()
  await expect(page.getByTestId('pace')).toHaveAttribute('data-axis', 'lap')
  await expect(page.getByTestId('pace-lap1')).toBeVisible()

  await page.getByTestId('analysis-tab-stints').click()
  expect(await page.getByTestId('stint-row').count()).toBeGreaterThanOrEqual(20)
  await expect(page.getByTestId('stint-bar').first()).toBeVisible()
})
