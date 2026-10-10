import { expect, type Page, test } from '@playwright/test'
import { gotoApp } from './helpers'

const FP1 = '/replay?s=2026/10-spa-francorchamps/fp1'

async function openScene(page: Page) {
  await gotoApp(page, FP1)
  await expect.poll(async () => (await page.evaluate(() => window.__trazada?.scene.ready)) ?? false, { timeout: 15_000 }).toBe(true)
}

test('una instancia por piloto, con su color y su sigla del manifest', async ({ page }) => {
  await openScene(page)
  const info = await page.evaluate(() => {
    const h = window.__trazada!
    return { drivers: h.drivers, colors: h.scene.instanceColors, cars: h.scene.instanceCars, instances: h.scene.instances }
  })
  expect(info.instances).toBe(info.drivers.length)
  const byNumber = new Map(info.drivers.map((d) => [d.number, d]))
  info.cars.forEach((car, i) => {
    expect(byNumber.has(car)).toBe(true)
    expect(info.colors[i]).toBe(byNumber.get(car)!.color.toUpperCase())
  })
  for (const d of info.drivers) {
    await expect(page.locator(`[data-testid="car-labels"] [data-car="${d.number}"]`)).toHaveText(d.tla)
  }
})

test('en pausa, un seek mueve los coches; un clic en la sigla selecciona', async ({ page }) => {
  await openScene(page)
  await page.locator('body').click({ position: { x: 5, y: 300 } })
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('Shift+ArrowRight')
  const before = await page.evaluate(() => window.__trazada!.cars())
  const renders = await page.evaluate(() => window.__trazada!.renders)
  await page.keyboard.press('Shift+ArrowRight')
  await expect.poll(() => page.evaluate(() => window.__trazada!.renders)).toBeGreaterThan(renders)
  const after = await page.evaluate(() => window.__trazada!.cars())
  const moved = after.filter((c, i) => c.visible && before[i]!.visible && Math.hypot(c.x - before[i]!.x, c.y - before[i]!.y) > 50)
  expect(moved.length).toBeGreaterThan(3)
  for (const [i, c] of after.entries()) if (c.visible && before[i]!.visible) expect(c.s).toBeGreaterThanOrEqual(before[i]!.s - 1e-6)

  const visible = after.find((c) => c.visible && !c.inPit)!
  const label = page.locator(`[data-testid="car-labels"] [data-car="${visible.car}"]`)
  await expect(label).toBeVisible()
  await label.click()
  await expect.poll(() => page.evaluate(() => window.__trazada!.selectedCar)).toBe(visible.car)
  await expect(label).toHaveAttribute('aria-pressed', 'true')
})
