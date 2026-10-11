/**
 * Japón 2026 (carrera) con los datos completos de data/ (fuente dev, no publicable: nunca va en un
 * fixture). Solo en local, con un servidor aparte:
 *   E2E_DATA_DIR=../../data node tests/e2e/serve.mjs --port 4199
 *   E2E_LOCAL_URL=http://127.0.0.1:4199 pnpm e2e local-japan
 */
import { expect, type Page, test } from '@playwright/test'
import { markTipsSeen, resetStorage } from './helpers'

const BASE = process.env.E2E_LOCAL_URL
test.skip(!BASE, 'solo en local (E2E_LOCAL_URL con data/ servido)')

const handle = <T>(page: Page, fn: (h: NonNullable<Window['__trazada']>) => T) =>
  page.evaluate(`(${fn.toString()})(window.__trazada)`) as Promise<T>

async function open(page: Page) {
  await markTipsSeen(page)
  await page.goto(`${BASE}/replay?s=2026/03-suzuka/race`)
  await page.waitForFunction(() => window.__trazada?.scene.ready, null, { timeout: 30_000 })
}

async function messages(page: Page) {
  return page.evaluate(async () => {
    const h = window.__trazada!
    h.seek(h.endMs)
    await new Promise((r) => setTimeout(r, 300))
    return [...document.querySelectorAll('[data-testid="rc-message"]')]
      .map((e) => ({ t: Number(e.getAttribute('data-t')), text: e.querySelector('[data-testid="rc-text"]')!.textContent }))
      .sort((a, b) => a.t - b.t)
  })
}

test('sector 21: amarillo 1 s después de YELLOW IN TRACK SECTOR 21 y neutro 1 s después del CLEAR', async ({ page }) => {
  await open(page)
  const rc = await messages(page)
  const yellow = rc.find((m) => m.text === 'YELLOW IN TRACK SECTOR 21')!
  const clear = rc.find((m) => m.text === 'CLEAR IN TRACK SECTOR 21' && m.t > yellow.t)!
  await page.evaluate((t) => window.__trazada!.seek(t), yellow.t + 1000)
  await expect.poll(() => handle(page, (h) => h.trackState.sectors[21])).toBe('YELLOW')
  await expect(page.locator('[data-testid="track-sector"][data-sectors~="21"]')).toBeVisible()
  await page.evaluate((t) => window.__trazada!.seek(t), clear.t + 1000)
  await expect.poll(() => handle(page, (h) => h.trackState.sectors[21] ?? null)).toBe(null)
})

test('SC, VSC y roja tiñen la pista 100 ms después de empezar cada ventana', async ({ page }) => {
  await open(page)
  const windows = await handle(page, (h) => h.markers.windows.filter((w) => ['sc', 'vsc', 'red'].includes(w.kind)))
  expect(windows.length).toBeGreaterThan(0)
  for (const w of windows) {
    await page.evaluate((t) => window.__trazada!.seek(t), w.fromMs + 100)
    await expect.poll(() => handle(page, (h) => h.trackState.neutral)).toBe(w.kind)
    await expect.poll(() => handle(page, (h) => h.scene.trackTint)).toBe(w.kind)
    await expect(page.getByTestId('track-neutral')).toHaveAttribute('data-kind', w.kind)
  }
})

test('timeline: ventanas de OVERTAKE (dos, cortadas por el safety car)', async ({ page }) => {
  await open(page)
  await expect(page.locator('[data-marker="assist"][data-kind="overtake"]')).toHaveCount(2)
})

test('vuelta 1: sin tiempo oficial; con "Estimar", tiempo marcado como Estimado', async ({ page }) => {
  await resetStorage(page)
  await open(page)
  // 20 s después de que el líder empiece la vuelta 2: los primeros ya han cerrado la vuelta 1.
  const t = await handle(page, (h) => h.markers.laps.find((l) => l.lap === 2)!.t + 20_000)
  await page.evaluate((x) => window.__trazada!.seek(x), t)
  await page.waitForTimeout(400) // el leaderboard publica su orden cada 150 ms
  await page.locator('[data-testid="leaderboard"] [data-car]').first().getByRole('button').click()
  await expect(page.getByTestId('lap-last')).toHaveText('—')
  await expect(page.locator('[data-field="lap1"]')).toHaveCount(0)
  await page.getByTestId('toggle-lap1').click()
  await expect(page.getByTestId('lap-last')).toHaveText(/^\d:\d\d[.,]\d{3}$/)
  await expect(page.locator('[data-testid="estimated"][data-field="lap1"]')).toBeVisible()
})

test('separación visual en la salida: los coches juntos se abren y se marca como Estimado', async ({ page }) => {
  await resetStorage(page)
  await open(page)
  const t = await handle(page, (h) => h.markers.laps[0]!.t + 3000)
  await page.evaluate((x) => window.__trazada!.seek(x), t)
  await page.getByTestId('toggle-separation').click()
  await expect.poll(() => handle(page, (h) => h.separatedCars)).toBeGreaterThan(1)
  await expect(page.locator('[data-testid="estimated"][data-field="separation"]')).toBeVisible()
  // Japón (fuente dev) declara posiciones, telemetría y estado de pista como estimados.
  for (const f of ['positions', 'trackStatus']) await expect(page.locator(`[data-field="${f}"]`)).toBeVisible()
})
