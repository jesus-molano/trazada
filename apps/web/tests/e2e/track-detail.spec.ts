/**
 * Detalle del trazado (D50, lámina 5): relieve (faldones hasta el suelo) y retícula, encendidos por defecto, dentro del
 * presupuesto de la escena; se apagan en «Capas» (lo dibujado baja a 0 draw calls) y se recuerdan al recargar; los
 * rótulos «Meta», «Entrada a boxes» y «Salida de boxes» salen con el circuito; «Cómo se dibuja» dice qué es dato y qué
 * decorativo; la escena sin errores de shader en la consola.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { gotoApp } from './helpers'

const FP1 = '/replay?s=2026/10-spa-francorchamps/fp1'

interface DetailStats {
  relief: boolean
  grid: boolean
  drawCalls: number
  triangles: number
}

const twoFrames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
const detail = (page: Page) => page.evaluate(() => window.__trazada!.scene.trackDetail as DetailStats)
const scene = (page: Page) => page.evaluate(() => ({ ...window.__trazada!.scene }))

async function openScene(page: Page) {
  await gotoApp(page, FP1)
  await expect.poll(async () => (await page.evaluate(() => window.__trazada?.scene.ready)) ?? false, { timeout: 15_000 }).toBe(true)
  await twoFrames(page)
}

async function openLayers(page: Page) {
  const button = page.getByTestId('tools-layers')
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click()
  await expect(page.getByTestId('track-detail-tool')).toBeVisible()
}

test('relieve y retícula por defecto, dentro del presupuesto; se apagan en «Capas» y se recuerdan', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error' && /shader|webgl|program/i.test(m.text())) errors.push(m.text())
  })
  await openScene(page)
  await expect.poll(() => detail(page)).toMatchObject({ relief: true, grid: true, drawCalls: 2 })
  const on = await scene(page)
  // Presupuesto de escena: tope de la escena base (13) más lo de cada capa activa, < 30 draw calls y < 150 000 triángulos.
  expect(on.drawCalls).toBeLessThanOrEqual(13 + on.layers.reduce((n, l) => n + l.drawCalls, 0))
  expect(on.drawCalls).toBeLessThan(30)
  expect(on.triangles).toBeLessThan(150_000)
  expect((await detail(page)).triangles).toBeGreaterThan(2)

  await openLayers(page)
  await page.getByTestId('relief-off').click()
  await page.getByTestId('grid-off').click()
  await expect(page.getByTestId('relief-off')).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => detail(page)).toMatchObject({ relief: false, grid: false, drawCalls: 0, triangles: 0 })
  await twoFrames(page)
  expect((await scene(page)).drawCalls).toBe(on.drawCalls - 2)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('trazada.trackDetail') ?? 'null'))).toEqual({
    relief: false,
    grid: false,
    _v: 1,
  })

  await page.reload()
  await expect.poll(async () => (await page.evaluate(() => window.__trazada?.scene.ready)) ?? false, { timeout: 15_000 }).toBe(true)
  await expect.poll(() => detail(page)).toMatchObject({ relief: false, grid: false, drawCalls: 0 })
  expect(errors).toEqual([])
})

test('rótulos del trazado y «Cómo se dibuja»', async ({ page }) => {
  await openScene(page)
  const tags = page.locator('.tz-labels--tag .tz-label')
  await expect(tags.filter({ hasText: /^(Meta|Finish)$/ })).toHaveCount(1)
  // El fixture de Spa trae pit lane: su entrada y su salida, en el color de boxes.
  await expect(page.locator('.tz-labels--tag .tz-label[data-tone="pit"]')).toHaveCount(2)
  await page.getByTestId('how-drawn').click()
  await expect(page.locator('[data-item="trackDetail"]')).toContainText(/retícula|grid/i)
  await expect(page.locator('[data-item="trackDetail"]')).toContainText(/320/)
})

test('accesible (axe) con «Capas» abierto', async ({ page }) => {
  await openScene(page)
  await openLayers(page)
  const results = await new AxeBuilder({ page }).include('[data-testid="track-detail-tool"]').analyze()
  expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([])
})
