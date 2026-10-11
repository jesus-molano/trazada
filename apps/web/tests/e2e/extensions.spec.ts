/**
 * Puntos de extensión (D29, Tanda 0): no cambian nada visible. Comprueba lo que exponen a los e2e de las funciones
 * que vendrán (capas con su coste, escena tapada) y los ayudantes de almacenamiento de los e2e.
 */
import { expect, type Page, test } from '@playwright/test'
import { gotoApp, resetStorage, TIPS_ALL_SEEN, TIPS_KEY } from './helpers'

const FP1 = '/replay?s=2026/10-spa-francorchamps/fp1'

async function openScene(page: Page) {
  await gotoApp(page, FP1)
  await expect.poll(async () => (await page.evaluate(() => window.__trazada?.scene.ready)) ?? false, { timeout: 15_000 }).toBe(true)
}

test('capas de la escena: cada una con su coste, y el render dentro del tope (13 + lo de las capas activas)', async ({ page }) => {
  await openScene(page)
  await page.evaluate(() => window.__trazada!.seek(window.__trazada!.startMs + 85_828))
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  const s = await page.evaluate(() => ({ ...window.__trazada!.scene }))
  expect(Array.isArray(s.layers)).toBe(true)
  for (const l of s.layers) {
    expect(typeof l.name).toBe('string')
    expect(l.drawCalls).toBeGreaterThanOrEqual(0)
    expect(l.triangles).toBeGreaterThanOrEqual(0)
  }
  expect(s.drawCalls).toBeLessThanOrEqual(13 + s.layers.reduce((n, l) => n + l.drawCalls, 0))
  expect(s.drawCalls).toBeLessThan(30)
  expect(s.triangles).toBeLessThan(150_000)
  expect(await page.evaluate(() => window.__trazada!.sceneHidden)).toBe(false)
})

test('resetStorage: almacenamiento vacío en cada carga, salvo las pistas de primer uso, que quedan vistas', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('trazada.settings', JSON.stringify({ elevationScale: 3 })))
  await resetStorage(page)
  await gotoApp(page, '/')
  const read = () =>
    page.evaluate(() => Object.fromEntries(Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!).map((k) => [k, localStorage.getItem(k)])))
  expect(await read()).toEqual({ [TIPS_KEY]: TIPS_ALL_SEEN })
  await page.evaluate(() => localStorage.setItem('trazada.settings', '{"gapMode":"interval"}'))
  await page.reload()
  expect(await read()).toEqual({ [TIPS_KEY]: TIPS_ALL_SEEN })
})

test('gotoApp marca las pistas de primer uso como vistas sin tocar lo demás ni un valor propio', async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('second')) localStorage.setItem('trazada.settings', '{"gapMode":"interval"}')
  })
  await gotoApp(page, '/')
  expect(await page.evaluate((k) => localStorage.getItem(k), TIPS_KEY)).toBe(TIPS_ALL_SEEN)
  expect(await page.evaluate(() => localStorage.getItem('trazada.settings'))).toBe('{"gapMode":"interval"}')
  // Un valor propio de las pistas (el que dejaría la app tras verlas) no se pisa al recargar.
  await page.evaluate((k) => {
    sessionStorage.setItem('second', '1')
    localStorage.setItem(k, '{"seen":["download"]}')
  }, TIPS_KEY)
  await page.reload()
  expect(await page.evaluate((k) => localStorage.getItem(k), TIPS_KEY)).toBe('{"seen":["download"]}')
})
