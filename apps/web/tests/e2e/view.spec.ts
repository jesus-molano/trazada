/**
 * Vista del mapa (D53) con el fixture (Spa 2026, libres 1): arrastrar el mapa lejos se para en el borde de la extensión
 * del circuito más su margen (el centro de la vista no sale de la caja), y «Centrar» (botón del mapa, que solo sale con
 * la vista movida, tecla C, menú «Cámara» y doble toque en el vacío) vuelve a la vista general por defecto; con la
 * realización encendida, la apaga y vuelve a la vista general. En escritorio con ratón y en tablet de 1024×768 táctil.
 */
import { expect, type Page, test } from '@playwright/test'
import { gotoApp, resetStorage } from './helpers'

const FP1 = '/replay?s=2026/10-spa-francorchamps/fp1'

interface ViewStat {
  target: [number, number] | null
  box: { minX: number; maxX: number; minZ: number; maxZ: number }
  moved: boolean
  flying: boolean
}

const view = (page: Page) => page.evaluate(() => window.__trazada!.scene.view as ViewStat)
const inBox = (v: ViewStat) =>
  v.target![0] >= v.box.minX - 1e-6 && v.target![0] <= v.box.maxX + 1e-6 && v.target![1] >= v.box.minZ - 1e-6 && v.target![1] <= v.box.maxZ + 1e-6
const near = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1])

async function openScene(page: Page) {
  await resetStorage(page)
  await gotoApp(page, FP1)
  await expect.poll(async () => (await page.evaluate(() => window.__trazada?.scene.ready)) ?? false, { timeout: 15_000 }).toBe(true)
  if (await page.evaluate(() => window.__trazada!.playing)) {
    await page.getByTestId('replay-title').click()
    await page.keyboard.press('Space')
  }
  await expect.poll(() => page.evaluate(() => window.__trazada!.playing)).toBe(false)
}

/** Centro del hueco libre del lienzo, en px de la página (sin paneles encima). */
async function freeCenter(page: Page) {
  const box = (await page.getByTestId('scene').boundingBox())!
  const f = await page.evaluate(() => window.__trazada!.scene.framing!.free)
  return { x: box.x + ((f.x0 + f.x1) / 4 + 0.5) * box.width, y: box.y + (0.5 - (f.y0 + f.y1) / 4) * box.height }
}

test.describe('escritorio', () => {
  test('arrastrar lejos se para en el borde; «Centrar» (botón y tecla C) vuelve a la vista general', async ({ page }) => {
    await openScene(page)
    const home = await view(page)
    expect(home.moved).toBe(false)
    await expect(page.getByTestId('scene-center')).toHaveCount(0)

    // Seis arrastres largos hacia la izquierda y arriba: el mapa se desplaza hacia el otro lado hasta el borde.
    const c = await freeCenter(page)
    for (let i = 0; i < 6; i++) {
      await page.mouse.move(c.x - 150, c.y - 100)
      await page.mouse.down()
      await page.mouse.move(c.x + 250, c.y + 200, { steps: 8 })
      await page.mouse.up()
    }
    const far = await view(page)
    expect(far.moved).toBe(true)
    expect(inBox(far), JSON.stringify(far)).toBe(true)
    // Ha llegado al borde (si no, el límite no se habría probado).
    const edge = Math.min(
      Math.abs(far.target![0] - far.box.minX),
      Math.abs(far.target![0] - far.box.maxX),
      Math.abs(far.target![1] - far.box.minZ),
      Math.abs(far.target![1] - far.box.maxZ),
    )
    expect(edge).toBeLessThan(1)

    // El botón del mapa: vuelve a la vista general y desaparece.
    await page.getByTestId('scene-center').click()
    await expect.poll(async () => (await view(page)).flying).toBe(false)
    const back = await view(page)
    expect(near(back.target!, home.target!)).toBeLessThan(1)
    expect(back.moved).toBe(false)
    await expect(page.getByTestId('scene-center')).toHaveCount(0)

    // Otra vez lejos y, ahora, la tecla C.
    await page.mouse.move(c.x, c.y)
    await page.mouse.down()
    await page.mouse.move(c.x + 300, c.y + 150, { steps: 6 })
    await page.mouse.up()
    expect((await view(page)).moved).toBe(true)
    await page.getByTestId('replay-title').click()
    await page.keyboard.press('c')
    await expect.poll(async () => (await view(page)).flying).toBe(false)
    expect(near((await view(page)).target!, home.target!)).toBeLessThan(1)
  })

  test('con la realización encendida, «Centrar» la apaga y la cámara vuelve a la vista general', async ({ page }) => {
    await openScene(page)
    const home = await view(page)
    await page.evaluate(() => window.__trazada!.seek(window.__trazada!.startMs + 150_000))
    await page.getByTestId('replay-title').click()
    await page.keyboard.press('t')
    await expect.poll(() => page.evaluate(() => window.__trazada!.scene.cameraMode)).not.toBe('overview')
    await expect(page.getByTestId('scene-center')).toBeVisible()
    await page.keyboard.press('c')
    await expect.poll(() => page.evaluate(() => window.__trazada!.scene.cameraMode), { timeout: 10_000 }).toBe('overview')
    expect(near((await view(page)).target!, home.target!)).toBeLessThan(1)
    await expect(page.getByTestId('scene-center')).toHaveCount(0)
  })
})

test.describe('tablet 1024×768 táctil', () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true })

  test('arrastrar con un dedo se para en el borde; el doble toque en el vacío centra', async ({ page }) => {
    await openScene(page)
    const home = await view(page)
    const cdp = await page.context().newCDPSession(page)
    const c = await freeCenter(page)
    for (let i = 0; i < 6; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x - 120, y: c.y - 80, id: 1 }] })
      for (let k = 1; k <= 8; k++) {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: c.x - 120 + 30 * k, y: c.y - 80 + 20 * k, id: 1 }],
        })
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    }
    const far = await view(page)
    expect(far.moved).toBe(true)
    expect(inBox(far), JSON.stringify(far)).toBe(true)
    await expect(page.getByTestId('scene-center')).toBeVisible()

    // Doble toque en el centro del hueco libre: con el mapa en el borde de su margen, ahí no hay pista ni coches.
    const t0 = Date.now() / 1000
    for (const [i, start] of [20, 170].entries()) {
      const points = [{ x: c.x, y: c.y, id: 10 + i }]
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points, timestamp: t0 + start / 1000 })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t0 + (start + 40) / 1000 })
    }
    await cdp.detach()
    await expect.poll(async () => (await view(page)).moved).toBe(false)
    await expect.poll(async () => (await view(page)).flying).toBe(false)
    expect(near((await view(page)).target!, home.target!)).toBeLessThan(1)
    expect(await page.evaluate(() => window.__trazada!.selectedCar)).toBeNull()
  })

  test('«Centrar» también está en el menú «Cámara»', async ({ page }) => {
    await openScene(page)
    const tool = page.getByTestId('tools-camera')
    if ((await tool.getAttribute('aria-expanded')) !== 'true') await tool.click()
    await expect(page.getByTestId('center-tool-button')).toBeDisabled()
  })
})
