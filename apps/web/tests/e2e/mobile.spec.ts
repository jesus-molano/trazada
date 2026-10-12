/**
 * Modo compacto (móvil y ventanas pequeñas; pendiente 3 del PLAN): el mapa en todo el escenario y los paneles en una
 * hoja inferior con pestañas (asomada, media, entera); la cabecera en una fila con «⋯» para las herramientas; sin scroll
 * horizontal. En el móvil en horizontal, el dock en una fila.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { gotoApp, settled } from './helpers'

const FP1 = '/replay?s=2026/10-spa-francorchamps/fp1'

const twoFrames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
const free = (page: Page) => page.evaluate(() => window.__trazada!.scene.framing!.free)
const stage = (page: Page) => page.locator('.tz-replay__stage')

async function openScene(page: Page) {
  await gotoApp(page, FP1)
  await expect.poll(async () => (await page.evaluate(() => window.__trazada?.scene.ready)) ?? false, { timeout: 15_000 }).toBe(true)
  await page.evaluate(() => window.__trazada!.seek(window.__trazada!.startMs + 85_828))
  await expect(page.getByTestId('sheet')).toBeVisible()
  await twoFrames(page)
}

test.describe('móvil en vertical 390×844', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('el mapa ocupa el escenario; la hoja abre la clasificación, el coche elegido y la dirección de carrera', async ({ page }) => {
    await openScene(page)
    // Asomada: solo la cabecera de la hoja, y el hueco libre del mapa casi todo el alto (en coordenadas de −1 a 1).
    await expect(stage(page)).toHaveAttribute('data-sheet', 'peek')
    await expect(page.getByTestId('leaderboard')).toBeHidden()
    const peek = await free(page)
    expect(peek.y1 - peek.y0).toBeGreaterThan(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)

    // Una pestaña con la hoja asomada la abre a media altura; el mapa se encuadra por encima.
    await page.getByTestId('sheet-tab-lb').click()
    await expect(stage(page)).toHaveAttribute('data-sheet', 'half')
    await expect(page.getByTestId('leaderboard')).toBeVisible()
    await expect.poll(async () => (await free(page)).y0).toBeGreaterThan(peek.y0 + 0.3)

    // Elegir un coche abre su pestaña (con su sigla) y su telemetría; la dirección de carrera sigue en la suya.
    await page.locator('[data-testid="leaderboard"] [data-car]').first().getByRole('button').click()
    await expect(page.getByTestId('sheet-tab-car')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('telemetry')).toBeVisible()
    await expect(page.getByTestId('race-control')).toBeHidden()
    await page.getByTestId('sheet-tab-rc').click()
    await expect(page.getByTestId('race-control')).toBeVisible()
    await expect(page.getByTestId('telemetry')).toBeHidden()

    // El asa recoge la hoja (un toque); la pestaña se queda.
    await page.getByTestId('sheet-handle').click()
    await expect(stage(page)).toHaveAttribute('data-sheet', 'peek')
    await expect(page.getByTestId('sheet-tab-rc')).toHaveAttribute('aria-selected', 'true')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  })

  test('la cabecera va en una fila; «⋯» despliega vista, escena, ayuda e idioma', async ({ page }) => {
    await openScene(page)
    const more = page.getByTestId('header-more')
    await expect(more).toBeVisible()
    await expect(page.getByTestId('scene-tools')).toBeHidden()
    await expect(page.getByTestId('lang-toggle')).toBeHidden()
    await more.click()
    await expect(more).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByTestId('scene-tools')).toBeVisible()
    await expect(page.getByTestId('lang-toggle')).toBeVisible()
    await expect(page.getByTestId('analysis-button')).toBeVisible()
    // Con la hoja no hay paneles que elegir.
    await expect(page.getByTestId('layout-switch')).toBeHidden()
    await more.click()
    await expect(page.getByTestId('scene-tools')).toBeHidden()
  })

  test('accesible (axe) con la hoja abierta', async ({ page }) => {
    await openScene(page)
    await page.getByTestId('sheet-tab-lb').click()
    await settled(page)
    const results = await new AxeBuilder({ page }).include('[data-testid="sheet"]').analyze()
    expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([])
  })
})

test.describe('móvil en horizontal 844×390', () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true })

  test('el dock en una fila y el mapa con sitio; sin scroll horizontal', async ({ page }) => {
    await openScene(page)
    const play = (await page.getByTestId('play-toggle').boundingBox())!
    const timeline = (await page.getByTestId('timeline').boundingBox())!
    expect(timeline.x).toBeGreaterThan(play.x + play.width)
    expect(Math.abs(timeline.y + timeline.height / 2 - (play.y + play.height / 2))).toBeLessThan(play.height)
    const f = await free(page)
    expect(f.y1 - f.y0).toBeGreaterThan(0.6)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(844)
  })
})
