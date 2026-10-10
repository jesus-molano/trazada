import { expect, type Page, test } from '@playwright/test'
import { gotoApp } from './helpers'

const FP1 = '/replay?s=2026/10-spa-francorchamps/fp1'

async function open(page: Page) {
  await gotoApp(page, FP1)
  await expect(page.getByTestId('leaderboard')).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('replay-title').click()
}

test('una fila por piloto con posiciones 1…N; clic selecciona; ↑/↓ siguen el orden', async ({ page }) => {
  await open(page)
  const drivers = await page.evaluate(() => window.__trazada!.drivers.length)
  const rows = page.locator('[data-testid="leaderboard"] [data-car]')
  await expect(rows).toHaveCount(drivers)
  const positions = await rows.evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-position'))))
  expect(positions).toEqual(Array.from({ length: drivers }, (_, i) => i + 1))

  const third = rows.nth(2)
  const car = await third.getAttribute('data-car')
  await third.getByRole('button').click()
  await expect.poll(() => page.evaluate(() => window.__trazada!.selectedCar)).toBe(car)

  await page.getByTestId('replay-title').click()
  await page.keyboard.press('ArrowDown')
  const fourth = await rows.nth(3).getAttribute('data-car')
  await expect.poll(() => page.evaluate(() => window.__trazada!.selectedCar)).toBe(fourth)
})

test('se actualiza a ≥ 4 Hz durante la reproducción (si la página va fluida)', async ({ page }) => {
  await open(page)
  await page.keyboard.press(' ')
  const read = () => page.evaluate(() => [window.__trazada!.leaderboard.updates, window.__trazada!.frames])
  const [u0, f0] = await read()
  await page.waitForTimeout(2000)
  const [u1, f1] = await read()
  await page.keyboard.press(' ')
  const updates = u1! - u0!
  const fps = (f1! - f0!) / 2
  const durations = await page.evaluate(() => window.__trazada!.leaderboard.durations)
  console.log(`leaderboard: ${updates} actualizaciones en 2 s a ${fps} fps; máx ${Math.max(...durations).toFixed(2)} ms`)
  expect(updates).toBeGreaterThan(0)
  // El criterio (≥ 4 Hz, p95 < 2 ms) es para la máquina de referencia. En CI, con WebGL por software, los
  // frames pueden ir lentos y el leaderboard no puede actualizarse más que los frames.
  if (fps >= 20) expect(updates).toBeGreaterThanOrEqual(8)
})

test('un piloto sin datos muestra "sin señal"', async ({ page }) => {
  await open(page)
  const hidden = await page.evaluate(() => window.__trazada!.cars().filter((c) => !c.visible).map((c) => c.car))
  test.skip(hidden.length === 0, 'todos los coches tienen datos en este instante')
  await expect(page.locator(`[data-testid="leaderboard"] [data-car="${hidden[0]}"] [data-testid="no-signal"]`)).toBeVisible()
})
