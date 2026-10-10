/**
 * Clasificación animada (ítem 8) con la torre real de Japón 2026 (carrera, datos completos de data/; fuente dev, nunca
 * en un fixture). Solo en local, con un servidor aparte:
 *   E2E_DATA_DIR=../../data node tests/e2e/serve.mjs --port 4199
 *   E2E_LOCAL_URL=http://127.0.0.1:4199 pnpm e2e local-leaderboard
 */
import { expect, type Page, test } from '@playwright/test'
import { markTipsSeen } from './helpers'

const BASE = process.env.E2E_LOCAL_URL
test.skip(!BASE, 'solo en local (E2E_LOCAL_URL con data/ servido)')

async function open(page: Page) {
  await markTipsSeen(page)
  await page.goto(`${BASE}/replay?s=2026/03-suzuka/race`)
  await page.waitForFunction(() => window.__trazada?.scene.ready, null, { timeout: 30_000 })
  await page.getByTestId('replay-title').click()
}

const changed = (page: Page) => page.locator('[data-testid="leaderboard"] [data-change]')

test('en las primeras vueltas la torre cambia: flechas con su texto, que un seek borra', async ({ page }) => {
  await open(page)
  const lap2 = await page.evaluate(() => window.__trazada!.markers.laps.find((l) => l.lap === 2)?.t ?? null)
  expect(lap2).not.toBeNull()
  await page.evaluate((t) => window.__trazada!.seek(t), lap2!)
  await expect(changed(page)).toHaveCount(0)
  // A ×4 (la velocidad máxima con FLIP): el primer cambio de la torre llega hacia el final de la vuelta 2.
  await page.getByTestId('rate-4').click()
  await page.getByTestId('replay-title').click()
  await page.keyboard.press(' ')
  await expect(changed(page).first()).toBeVisible({ timeout: 60_000 })
  // Las flechas caducan a los pocos segundos de pared: los textos se leen al momento.
  const texts = await page
    .locator('[data-testid="leaderboard"] [data-testid="rank-change"] .tz-visually-hidden')
    .allTextContents()
  await page.keyboard.press(' ')
  expect(texts.length).toBeGreaterThan(0)
  for (const text of texts) expect(text).toMatch(/(ganó|perdió) \d+ posici|(gained|lost) \d+ place/)
  // Ninguna flecha en una fila sin puesto conocido.
  await expect(page.locator('[data-testid="leaderboard"] [data-position-known="false"][data-change]')).toHaveCount(0)

  await page.evaluate((t) => window.__trazada!.seek(t), lap2! + 600_000)
  await expect(changed(page)).toHaveCount(0)
})
