/**
 * Mapa de calor (ítem 2, D32) con el fixture de Spa (libres 1, extracto de 9 min, de 4 230 000 a 4 770 000 ms):
 * apagado por defecto; «Velocidad» de la última vuelta válida de GAS (la 22, entera dentro del extracto) en una draw
 * call, sin niebla, dentro del presupuesto y sin «Estimado»; su mejor vuelta (la 12) es de antes del extracto y sale
 * «sin dato», nunca otra; «Minisectores» GAS frente a HAM con el recuento de los 25 y la etiqueta «Estimado» a la
 * vista; las banderas de sector se siguen viendo; sin renders en pausa; el modo se recuerda al recargar.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { gotoApp } from './helpers'

const FP1 = '/replay?s=2026/10-spa-francorchamps/fp1'
/** Instante absoluto (ms de sesión): GAS ya cerró su vuelta 22 y HAM su vuelta 20, las dos con posiciones. */
const T_ABS = 4_700_000

interface HeatStats {
  mode: 'off' | 'speed' | 'minisectors'
  status: 'off' | 'ok' | 'noPair' | 'noLap' | 'noData'
  version: number
  car: string | null
  lap: number | null
  carB: string | null
  lapB: number | null
  sessionBest: boolean
  minKmh: number | null
  maxKmh: number | null
  minisectors: { a: number; b: number; tie: number; none: number } | null
  points: number
  colored: number
  uploads: number
  drawCalls: number
  triangles: number
  fogged: boolean
  renderOrder: number
}

const twoFrames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
const heat = (page: Page) => page.evaluate(() => window.__trazada!.scene.heat as HeatStats)
const scene = (page: Page) => page.evaluate(() => ({ ...window.__trazada!.scene }))

async function seekTo(page: Page, ms: number) {
  await page.evaluate((t) => window.__trazada!.seek(t), ms)
  await twoFrames(page)
}

/** Cada test tiene un contexto nuevo (almacenamiento vacío): sin `resetStorage`, que vaciaría también al recargar. */
async function openScene(page: Page) {
  await gotoApp(page, FP1)
  await expect.poll(async () => (await page.evaluate(() => window.__trazada?.scene.ready)) ?? false, { timeout: 15_000 }).toBe(true)
  await seekTo(page, T_ABS)
}

/** La herramienta va en el menú «Capas» de las herramientas de escena: lo abre si está cerrado. */
async function openLayers(page: Page) {
  const button = page.getByTestId('tools-layers')
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click()
  await expect(page.getByTestId('heat-tool')).toBeVisible()
}

const row = (page: Page, car: string) => page.locator(`[data-testid="leaderboard"] [data-car="${car}"]`)

async function selectCar(page: Page, car: string) {
  await row(page, car).getByRole('button').click()
  await expect(page.getByTestId('telemetry')).toHaveAttribute('data-car', car)
}

/** Espera a que el contador de renders deje de moverse y lo devuelve. */
async function settledRenders(page: Page): Promise<number> {
  let before = -1
  await expect
    .poll(
      async () => {
        const now = await page.evaluate(() => window.__trazada!.renders)
        const stable = now === before
        before = now
        return stable
      },
      { intervals: [400], timeout: 10_000 },
    )
    .toBe(true)
  return before
}

test('apagado por defecto: la capa existe sin draw calls y sin etiqueta', async ({ page }) => {
  await openScene(page)
  await openLayers(page)
  await expect(page.getByTestId('heat-off')).toHaveAttribute('aria-pressed', 'true')
  expect(await heat(page)).toMatchObject({ mode: 'off', status: 'off', drawCalls: 0, triangles: 0, fogged: false })
  const base = await scene(page)
  expect(base.layers.find((l) => l.name === 'heat')).toMatchObject({ drawCalls: 0, triangles: 0, fogged: false })
  await expect(page.locator('[data-testid="estimated"][data-field="minisectors"]')).toHaveCount(0)
})

test('velocidad: la mejor vuelta fuera del extracto es «sin dato»; la última, una draw call con su escala y sin «Estimado»', async ({
  page,
}) => {
  await openScene(page)
  await selectCar(page, '10')
  await openLayers(page)
  const flagsBefore = (await scene(page)).sectorOverlays
  const base = await scene(page)

  await page.getByTestId('heat-speed').click()
  // En libres, por defecto la más rápida: la 12 de GAS, de antes del extracto (sin posiciones). Nunca otra vuelta.
  await expect(page.getByTestId('heat-pick-best')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('heat-tool')).toHaveAttribute('data-status', 'noData')
  await expect(page.getByTestId('heat-note')).toHaveText(/^(Sin dato|No data):.*12.*GAS$/)
  // La capa sube la vista nueva en el siguiente render (onBeforeRender), que puede llegar después que el DOM.
  await expect.poll(() => heat(page)).toMatchObject({ mode: 'speed', status: 'noData', car: '10', lap: 12, drawCalls: 0 })

  await page.getByTestId('heat-pick-last').click()
  await expect(page.getByTestId('heat-tool')).toHaveAttribute('data-status', 'ok')
  await expect.poll(async () => (await heat(page)).drawCalls).toBe(1)
  await twoFrames(page)
  const on = await heat(page)
  expect(on).toMatchObject({ mode: 'speed', status: 'ok', car: '10', lap: 22, fogged: false, renderOrder: 0.5 })
  // Casi toda la vuelta con color; la escala, la de lo que midió (km/h plausibles en Spa).
  expect(on.colored / on.points).toBeGreaterThan(0.9)
  expect(on.minKmh!).toBeGreaterThan(50)
  expect(on.maxKmh!).toBeLessThan(360)
  expect(on.triangles).toBeGreaterThan(0)
  expect(on.triangles).toBeLessThanOrEqual(2 * on.points)
  await expect(page.getByTestId('heat-legend')).toContainText(/km\/h/)
  await expect(page.getByTestId('heat-legend')).toContainText(/(muestreo ~4 Hz|sampled at ~4 Hz)/)
  await expect(page.getByTestId('heat-laps')).toContainText(/^GAS · (vuelta|lap) 22 · 1:54/)
  // La velocidad es dato real: ninguna etiqueta «Estimado» del mapa de calor.
  await expect(page.locator('[data-testid="estimated"][data-field="minisectors"]')).toHaveCount(0)

  const now = await scene(page)
  // Una draw call más (la cámara no se ha movido y el reloj está en pausa), dentro del presupuesto (plan §5).
  expect(now.drawCalls).toBe(base.drawCalls + 1)
  expect(now.drawCalls).toBeLessThanOrEqual(13 + now.layers.reduce((n, l) => n + l.drawCalls, 0))
  expect(now.drawCalls).toBeLessThan(30)
  expect(now.triangles).toBeLessThan(150_000)
  for (const l of now.layers) expect(l.fogged, l.name).toBe(false)
  // Las banderas de sector siguen igual: el calor no las tapa ni las quita.
  expect(now.sectorOverlays).toEqual(flagsBefore)

  // Por navegador, con su versión de formato; la vuelta elegida no se guarda.
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('trazada.heat') ?? 'null'))).toEqual({ mode: 'speed', _v: 1 })
})

test('minisectores: sin comparación lo dice; GAS frente a HAM, 25 tramos con «Estimado» a la vista', async ({ page }) => {
  await openScene(page)
  await selectCar(page, '10')
  await openLayers(page)
  await page.getByTestId('heat-minisectors').click()
  await expect(page.getByTestId('heat-tool')).toHaveAttribute('data-status', 'noPair')
  await expect(page.getByTestId('heat-note')).toContainText(/(Mayús\+clic|Shift\+click)/)
  expect((await heat(page)).drawCalls).toBe(0)

  // B con Mayús+clic en la clasificación.
  await row(page, '44').getByRole('button').click({ modifiers: ['Shift'] })
  await expect(page.getByTestId('compare-toggle')).toHaveAttribute('aria-pressed', 'true')
  await openLayers(page)
  await page.getByTestId('heat-pick-last').click()
  await expect(page.getByTestId('heat-tool')).toHaveAttribute('data-status', 'ok')
  await expect.poll(async () => (await heat(page)).drawCalls).toBe(1)
  const on = await heat(page)
  expect(on).toMatchObject({ mode: 'minisectors', car: '10', lap: 22, carB: '44', lapB: 20, fogged: false })
  const n = on.minisectors!
  expect(n.a + n.b + n.tie + n.none).toBe(25)
  await expect(page.getByTestId('heat-count-a')).toHaveText(`GAS: ${n.a}`)
  await expect(page.getByTestId('heat-count-b')).toHaveText(`HAM: ${n.b}`)
  // La etiqueta, junto a la leyenda y en la fila de la escena (visible con el menú cerrado).
  await expect(page.locator('[data-testid="heat-tool"] [data-testid="estimated"][data-field="minisectors"]')).toBeVisible()
  await page.getByTestId('tools-layers').click()
  await expect(page.getByTestId('heat-tool')).toBeHidden()
  await expect(page.locator('.tz-tools__estimated [data-testid="estimated"][data-field="minisectors"]')).toBeVisible()
})

test('en pausa no se renderiza en bucle ni se vuelven a subir colores; al cambiar de vuelta, sí', async ({ page }) => {
  await openScene(page)
  await selectCar(page, '10')
  await openLayers(page)
  await page.getByTestId('heat-speed').click()
  await page.getByTestId('heat-pick-last').click()
  await expect.poll(async () => (await heat(page)).drawCalls).toBe(1)
  const uploads = (await heat(page)).uploads
  const before = await settledRenders(page)
  await page.waitForTimeout(500)
  expect(await page.evaluate(() => window.__trazada!.renders)).toBe(before)
  // Un seek dentro de la misma vuelta: otro render, los mismos colores.
  await seekTo(page, T_ABS + 20_000)
  await expect.poll(() => page.evaluate(() => window.__trazada!.renders)).toBeGreaterThan(before)
  expect((await heat(page)).uploads).toBe(uploads)
  // Antes de cerrar la 22: la vuelta pintada es la anterior válida (la 21).
  await seekTo(page, 4_500_000)
  await expect.poll(async () => (await heat(page)).lap).toBe(21)
  expect((await heat(page)).uploads).toBeGreaterThan(uploads)
})

test('se recuerda al recargar; la herramienta es accesible y la pista explica qué es dato', async ({ page }) => {
  await openScene(page)
  await openLayers(page)
  await page.getByTestId('heat-speed').click()
  await page.reload()
  await expect.poll(async () => (await page.evaluate(() => window.__trazada?.scene.ready)) ?? false, { timeout: 15_000 }).toBe(true)
  await openLayers(page)
  await expect(page.getByTestId('heat-speed')).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('heat-hint').click()
  await expect(page.getByTestId('heat-hint-panel')).toBeVisible()
  await expect(page.getByTestId('heat-hint-panel')).toContainText(/~4 Hz/)
  await expect(page.getByTestId('heat-hint-panel')).toContainText(/50 ms/)
  const results = await new AxeBuilder({ page })
    .include('[data-testid="scene-tools"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)
  expect(serious).toEqual([])
})
