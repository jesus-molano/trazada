/**
 * Colores de sector (ítem 4, D34) sobre el fixture (Spa 2026, libres 1). La tabla de vueltas del fixture es la de toda
 * la sesión y la reproducción es un extracto (startMs = 4 230 000), así que las primeras vueltas que se ven ya traen
 * los mejores de antes:
 *
 * - COL (43), vuelta 19 (meta en 4 213 274, antes del extracto): S1 31,237 y S3 29,144 son su mejor personal; S2
 *   49,112, sin mejora.
 * - ALB (23), vuelta 20 (meta en 4 265 394): anulada por dirección de carrera en 4 280 828.
 * - RUS (63), vuelta 20 (meta en 4 420 685): sin tiempo de S1.
 *
 * Cada fila lleva sus tres marcas con texto (nunca solo el color) y el aviso de que los calcula Trazada; el panel del
 * coche seleccionado muestra los tiempos con los mismos colores. Accesible (axe) en español y en inglés.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { gotoApp, resetStorage, settled } from './helpers'

const FP1 = '/replay?s=2026/10-spa-francorchamps/fp1'
const STATES = ['best', 'personal', 'normal', 'none', 'deleted']
const BASIS_ES = 'Colores calculados por Trazada con los tiempos oficiales; no son las marcas del cronometraje.'

async function open(page: Page, baseURL: string | undefined, lang: 'es' | 'en' = 'es') {
  await page.context().addCookies([{ name: 'trazada_lang', value: lang, url: baseURL ?? 'http://127.0.0.1' }])
  await resetStorage(page)
  await gotoApp(page, FP1)
  await expect.poll(async () => (await page.evaluate(() => window.__trazada?.scene.ready)) ?? false, { timeout: 15_000 }).toBe(true)
  await page.getByTestId('replay-title').click()
}

/** Seek a `startMs + offset` con precisión de ms y dos frames para que la interfaz lo refleje. */
async function seekOffset(page: Page, offset: number) {
  await page.evaluate((dt) => window.__trazada!.seek(window.__trazada!.startMs + dt), offset)
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
}

const cell = (page: Page, car: string) => page.locator(`[data-testid="leaderboard"] [data-car="${car}"] [data-testid="lb-sectors"]`)
const states = (page: Page, car: string) =>
  cell(page, car)
    .locator('[data-sector]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-state')))

test('cada fila: tres marcas con su estado, texto para lectores de pantalla y el aviso de que no son las del cronometraje', async ({ page, baseURL }) => {
  await open(page, baseURL)
  await seekOffset(page, 1_000)
  const drivers = await page.evaluate(() => window.__trazada!.drivers.length)
  await expect(page.locator('[data-testid="leaderboard"] [data-testid="lb-sectors"]')).toHaveCount(drivers)
  const all = await page
    .locator('[data-testid="leaderboard"] [data-testid="lb-sectors"] [data-sector]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-state')))
  expect(all).toHaveLength(drivers * 3)
  for (const s of all) expect(STATES).toContain(s)

  // COL: la última vuelta completada es la 19, con S1 y S3 de mejor personal.
  await expect(cell(page, '43')).toHaveAttribute('data-lap', '19')
  await expect.poll(() => states(page, '43')).toEqual(['personal', 'normal', 'personal'])
  await expect(cell(page, '43').locator('.tz-visually-hidden')).toHaveText(
    'Sectores de la vuelta 19: S1 31,237 (mejor personal), S2 49,112 (sin mejora), S3 29,144 (mejor personal).',
  )
  const title = await cell(page, '43').getAttribute('title')
  expect(title).toContain('S1 31,237 (mejor personal)')
  expect(title).toContain(BASIS_ES)
  // Las marcas no tienen texto propio: lo lleva la celda.
  for (const aria of await cell(page, '43').locator('[data-sector]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-hidden')))) {
    expect(aria).toBe('true')
  }
  // Nunca una «mejor vuelta posible».
  await expect(page.getByTestId('leaderboard')).not.toContainText(/mejor vuelta posible/i)
})

test('vuelta anulada desde el mensaje de dirección de carrera; sector sin tiempo, gris «sin dato»', async ({ page, baseURL }) => {
  await open(page, baseURL)
  // ALB, vuelta 20: cuenta hasta el mensaje (4 280 828) y desde entonces sale anulada.
  await seekOffset(page, 40_000)
  await expect(cell(page, '23')).toHaveAttribute('data-lap', '20')
  await expect(cell(page, '23')).toHaveAttribute('data-deleted', 'false')
  await seekOffset(page, 60_000)
  await expect(cell(page, '23')).toHaveAttribute('data-deleted', 'true')
  await expect.poll(() => states(page, '23')).toEqual(['deleted', 'deleted', 'deleted'])
  await expect(cell(page, '23').locator('.tz-visually-hidden')).toContainText('anulada por dirección de carrera')

  // RUS, vuelta 20: sin tiempo de S1.
  await seekOffset(page, 195_000)
  await expect(cell(page, '63')).toHaveAttribute('data-lap', '20')
  await expect.poll(async () => (await states(page, '63'))[0]).toBe('none')
  await expect(cell(page, '63').locator('.tz-visually-hidden')).toContainText('S1: sin dato')
})

test('panel del coche seleccionado: tiempos oficiales de sus sectores con los mismos colores y la pista', async ({ page, baseURL }) => {
  await open(page, baseURL)
  await seekOffset(page, 1_000)
  await page.locator('[data-testid="leaderboard"] [data-car="43"]').getByRole('button').click()
  await expect.poll(() => page.evaluate(() => window.__trazada!.selectedCar)).toBe('43')
  const row = page.getByTestId('lap-sectors')
  await expect(row).toHaveAttribute('data-lap', '19')
  const sectors = row.getByTestId('lap-sector')
  await expect(sectors).toHaveCount(3)
  expect(await sectors.evaluateAll((els) => els.map((e) => e.getAttribute('data-state')))).toEqual(['personal', 'normal', 'personal'])
  await expect(sectors.nth(0)).toContainText('31,237')
  await expect(sectors.nth(1)).toContainText('49,112')
  await expect(sectors.nth(2)).toContainText('29,144')
  // La pista se abre al pulsar (iPad: un título no se ve) y explica los colores y su origen.
  await page.getByTestId('sectors-hint').click()
  await expect(page.getByTestId('sectors-hint-panel')).toBeVisible()
  await expect(page.getByTestId('sectors-hint-panel')).toContainText(BASIS_ES)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('sectors-hint-panel')).toBeHidden()
})

for (const vp of [
  { name: 'escritorio 1280×800', width: 1280, height: 800 },
  { name: 'iPad horizontal 1024×768', width: 1024, height: 768 },
]) {
  test(`${vp.name}: las marcas caben en la fila sin quitar sitio a las demás columnas`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await open(page, baseURL)
    await seekOffset(page, 1_000)
    const boxes = await page.evaluate(() => {
      const row = document.querySelector('[data-testid="leaderboard"] [data-car="43"] .tz-lb__btn')!
      const r = row.getBoundingClientRect()
      const box = (sel: string) => row.querySelector(sel)!.getBoundingClientRect()
      return { row: { left: r.left, right: r.right }, sectors: box('[data-testid="lb-sectors"]'), tyre: box('.tz-lb__tyre'), flags: box('.tz-lb__flags') }
    })
    expect(boxes.sectors.width).toBeGreaterThanOrEqual(20)
    expect(boxes.sectors.left).toBeGreaterThanOrEqual(boxes.tyre.right)
    expect(boxes.sectors.right).toBeLessThanOrEqual(boxes.row.right)
    // La columna de las insignias (flecha, PIT, bandera azul) conserva su sitio: el de antes de las celdas (38 px en
    // escritorio y 30 en iPad), porque el panel se ensancha lo que ellas ocupan.
    expect(boxes.flags.width).toBeGreaterThanOrEqual(29)
    const overflow = await page.evaluate(() => {
      const el = document.querySelector('.tz-lb__rows')!
      return el.scrollWidth - el.clientWidth
    })
    expect(overflow).toBeLessThanOrEqual(0)
  })
}

for (const lang of ['es', 'en'] as const) {
  test(`accesible (axe, ${lang}): clasificación con sectores y panel del coche seleccionado`, async ({ page, baseURL }) => {
    await open(page, baseURL, lang)
    await seekOffset(page, 1_000)
    await page.locator('[data-testid="leaderboard"] [data-car="43"]').getByRole('button').click()
    await expect(page.getByTestId('lap-sectors')).toBeVisible()
    await settled(page)
    const results = await new AxeBuilder({ page })
      .include('[data-testid="leaderboard"]')
      .include('[data-testid="telemetry"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    const serious = results.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)
    expect(serious).toEqual([])
  })
}
