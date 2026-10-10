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
  // Se registran los instantes de cada frame para saber cuántas actualizaciones permitía la cadencia real.
  await page.evaluate(() => {
    const w = window as Window & { __frameTimes?: number[] }
    w.__frameTimes = []
    const tick = (now: number) => {
      w.__frameTimes!.push(now)
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  await page.keyboard.press(' ')
  const read = () => page.evaluate(() => window.__trazada!.leaderboard.updates)
  const u0 = await read()
  const t0 = await page.evaluate(() => performance.now())
  await page.waitForTimeout(2000)
  const u1 = await read()
  const times = await page.evaluate((from) => {
    const all = (window as Window & { __frameTimes?: number[] }).__frameTimes ?? []
    return all.filter((t) => t >= from)
  }, t0)
  await page.keyboard.press(' ')
  const updates = u1 - u0
  // Con la misma regla que el leaderboard (≥ 150 ms entre actualizaciones), ¿cuántas cabían en estos frames?
  let last = -Infinity
  let possible = 0
  for (const t of times) {
    if (t - last >= 150) {
      possible++
      last = t
    }
  }
  const gaps = times.slice(1).map((t, i) => t - times[i]!).sort((a, b) => a - b)
  const p95gap = gaps[Math.floor(gaps.length * 0.95)] ?? Infinity
  const durations = await page.evaluate(() => window.__trazada!.leaderboard.durations)
  console.log(
    `leaderboard: ${updates} actualizaciones en 2 s (cabían ${possible}; p95 entre frames ${p95gap.toFixed(0)} ms); máx ${Math.max(...durations).toFixed(2)} ms`,
  )
  expect(updates).toBeGreaterThan(0)
  // Nunca menos de las que permitía la cadencia de frames (margen por el desfase entre bucles).
  expect(updates).toBeGreaterThanOrEqual(possible - 2)
  // El criterio (≥ 4 Hz) es para la máquina de referencia; aquí se exige solo si los frames son regulares
  // (con WebGL por software en CI llegan a ráfagas y el leaderboard no puede ir más rápido que ellos).
  if (p95gap < 50) expect(updates).toBeGreaterThanOrEqual(8)
})

test('un piloto sin datos muestra "sin señal"', async ({ page }) => {
  await open(page)
  const hidden = await page.evaluate(() => window.__trazada!.cars().filter((c) => !c.visible).map((c) => c.car))
  test.skip(hidden.length === 0, 'todos los coches tienen datos en este instante')
  await expect(page.locator(`[data-testid="leaderboard"] [data-car="${hidden[0]}"] [data-testid="no-signal"]`)).toBeVisible()
})
