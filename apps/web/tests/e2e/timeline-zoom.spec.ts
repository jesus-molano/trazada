/**
 * Zoom y desplazamiento de la línea de tiempo (D56): la rueda acerca en el cursor (el instante bajo él
 * no se mueve), Mayús + rueda desplaza, los botones y las teclas + y − con el foco, «×N» vuelve a toda la sesión; un clic
 * con zoom cae en el instante que se ve (no en el de la sesión entera); la barra de lo que se ve sale solo con zoom; con
 * el cabezal fuera de la vista, un salto la lleva hasta él.
 */
import { expect, type Page, test } from '@playwright/test'
import { gotoApp } from './helpers'

const FP1 = '/replay?s=2026/10-spa-francorchamps/fp1'

const time = (page: Page) => page.evaluate(() => window.__trazada!.timeMs - window.__trazada!.startMs)
const duration = (page: Page) => page.evaluate(() => window.__trazada!.endMs - window.__trazada!.startMs)
const frame = async (page: Page) => (await page.locator('.tz-timeline__frame').boundingBox())!
const track = async (page: Page) => (await page.getByTestId('timeline').boundingBox())!

/** Instante (ms desde el inicio) que cae en la x de pantalla, con la caja de la pista. */
async function timeAtX(page: Page, x: number) {
  const r = await track(page)
  return ((x - r.x) / r.width) * (await duration(page))
}

async function open(page: Page) {
  await gotoApp(page, FP1)
  await expect.poll(async () => (await page.evaluate(() => window.__trazada?.scene.ready)) ?? false, { timeout: 15_000 }).toBe(true)
}

test.use({ viewport: { width: 1440, height: 900 } })

test('la rueda acerca en el cursor; un clic con zoom cae en el instante que se ve; «×N» vuelve a toda la sesión', async ({ page }) => {
  await open(page)
  await expect(page.getByTestId('timeline-zoom-out')).toBeDisabled()
  await expect(page.getByTestId('timeline-scroll')).toBeHidden()
  const f0 = await frame(page)
  const cursor = { x: f0.x + f0.width * 0.4, y: f0.y + 10 }
  const anchor = await timeAtX(page, cursor.x)
  await page.mouse.move(cursor.x, cursor.y)
  await page.mouse.wheel(0, -600)
  await page.mouse.wheel(0, -600)
  // Más ancha que su marco, con el mismo instante bajo el cursor (a unos píxeles: redondeos de los %).
  await expect.poll(async () => (await track(page)).width).toBeGreaterThan(f0.width * 3)
  const f1 = await frame(page)
  expect(f1.width).toBeCloseTo(f0.width, 0)
  const pxPerMs = (await track(page)).width / (await duration(page))
  expect(Math.abs((await timeAtX(page, cursor.x)) - anchor) * pxPerMs).toBeLessThan(4)
  await expect(page.getByTestId('timeline-zoom-reset')).toBeVisible()
  await expect(page.getByTestId('timeline-scroll')).toBeVisible()

  // Un clic en el borde derecho de lo que se ve: el instante de ese borde, no el final de la sesión.
  const edgeX = f1.x + f1.width - 3
  const expected = await timeAtX(page, edgeX)
  await page.mouse.click(edgeX, cursor.y)
  await expect.poll(() => time(page)).toBeGreaterThan(expected - 2000)
  expect(await time(page)).toBeLessThan(expected + 2000)
  expect(expected).toBeLessThan((await duration(page)) * 0.8)

  // Mayús + rueda desplaza (el zoom no cambia).
  const before = (await track(page)).x
  await page.keyboard.down('Shift')
  await page.mouse.wheel(0, 300)
  await page.keyboard.up('Shift')
  await expect.poll(async () => (await track(page)).x).toBeLessThan(before - 50)

  await page.getByTestId('timeline-zoom-reset').click()
  await expect.poll(async () => Math.round((await track(page)).width)).toBe(Math.round(f1.width))
  await expect(page.getByTestId('timeline-scroll')).toBeHidden()
})

test('botones y teclas; con el cabezal fuera de la vista, un salto la lleva hasta él', async ({ page }) => {
  await open(page)
  const f0 = await frame(page)
  await page.getByTestId('timeline-zoom-in').click()
  await page.getByTestId('timeline-zoom-in').click()
  await expect.poll(async () => (await track(page)).width).toBeGreaterThan(f0.width * 3.5)
  await page.getByTestId('timeline-zoom-out').click()
  await expect.poll(async () => (await track(page)).width).toBeLessThan(f0.width * 2.5)
  // Con el foco en la línea de tiempo: + acerca, − aleja.
  await page.getByTestId('timeline').focus()
  await page.keyboard.press('+')
  await expect.poll(async () => (await track(page)).width).toBeGreaterThan(f0.width * 3.5)

  // Un salto lejos (Fin): pasados los segundos de la última acción a mano, la vista va hasta el cabezal.
  await page.waitForTimeout(5200)
  await page.keyboard.press('End')
  await expect
    .poll(async () => {
      const head = (await page.locator('.tz-timeline__head').boundingBox())!
      const f = await frame(page)
      return head.x >= f.x - 2 && head.x <= f.x + f.width + 2
    })
    .toBe(true)
})
