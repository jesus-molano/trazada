/**
 * Escritorio y tablet: sin scroll horizontal en la página ni en los paneles; en tablet (táctil), tocar un
 * coche lo selecciona y arrastrar el timeline con el dedo mueve el reloj.
 */
import { expect, type Page, test } from '@playwright/test'
import { gotoApp } from './helpers'

const FP1 = '/replay?s=2026/10-spa-francorchamps/fp1'
const PANELS = [
  '.tz-replay__bar',
  '[data-testid="scene-tools"]',
  '[data-testid="leaderboard"]',
  '.tz-lb__rows',
  '[data-testid="telemetry"]',
  '[data-testid="race-control"]',
  '.tz-rc__list',
  '[data-testid="replay-dock"]',
]

async function open(page: Page) {
  await gotoApp(page, FP1)
  await expect.poll(async () => (await page.evaluate(() => window.__trazada?.scene.ready)) ?? false, { timeout: 15_000 }).toBe(true)
  // Un minuto y medio dentro del extracto: coches en pista y la doble amarilla del sector 7 activa.
  await page.evaluate(() => window.__trazada!.seek(window.__trazada!.startMs + 85_828))
  await expect.poll(() => page.evaluate(() => window.__trazada!.cars().filter((c) => c.visible).length)).toBeGreaterThan(5)
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
}

/** Elementos con contenido más ancho que su caja (scrollWidth > clientWidth), página incluida. */
function overflowing(page: Page) {
  return page.evaluate((selectors) => {
    const out: string[] = []
    const doc = document.documentElement
    if (doc.scrollWidth > doc.clientWidth) out.push(`página ${doc.scrollWidth} > ${doc.clientWidth}`)
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        if (el.scrollWidth > el.clientWidth) out.push(`${sel} ${el.scrollWidth} > ${el.clientWidth}`)
      }
    }
    return out
  }, PANELS)
}

/** Punto en pantalla de un coche aislado, sobre el lienzo (debajo de su sigla). */
async function carOnScreen(page: Page) {
  const hit = await page.evaluate(() => {
    const labels = [...document.querySelectorAll<HTMLElement>('[data-testid="car-labels"] [data-car]')]
      .filter((el) => getComputedStyle(el).visibility === 'visible')
      .map((el) => {
        const r = el.getBoundingClientRect()
        return { car: el.dataset.car!, x: r.left + r.width / 2, y: r.bottom + 14 }
      })
    for (const l of labels) {
      const alone = labels.every((o) => o === l || Math.hypot(o.x - l.x, o.y - l.y) > 40)
      if (alone && document.elementFromPoint(l.x, l.y)?.tagName === 'CANVAS') return l
    }
    return null
  })
  expect(hit).not.toBeNull()
  return hit!
}

const VIEWPORTS = [
  { name: 'escritorio 1440×900', width: 1440, height: 900, touch: false },
  { name: 'escritorio 1280×800', width: 1280, height: 800, touch: false },
  { name: 'iPad horizontal 1024×768', width: 1024, height: 768, touch: true },
  { name: 'iPad vertical 768×1024', width: 768, height: 1024, touch: true },
]

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch })

    test('sin scroll horizontal en la página ni en los paneles (también con telemetría y Estimado)', async ({ page }) => {
      await page.addInitScript(() => localStorage.clear())
      await open(page)
      expect(await overflowing(page)).toEqual([])
      await page.locator('[data-testid="leaderboard"] [data-car]').nth(9).getByRole('button').click()
      await expect(page.getByTestId('telemetry')).toBeVisible()
      await page.getByTestId('elevation-3').click()
      await page.getByTestId('toggle-separation').click()
      await expect(page.locator('[data-testid="estimated"]')).toHaveCount(2)
      expect(await overflowing(page)).toEqual([])
    })

    if (!vp.touch) {
      test('con un coche elegido, las gráficas de telemetría se ven sin hacer scroll', async ({ page }) => {
        await open(page)
        await page.locator('[data-testid="leaderboard"] [data-car]').first().getByRole('button').click()
        const panel = page.getByTestId('telemetry')
        await expect(panel).toBeVisible()
        const hidden = await panel.evaluate((el) => {
          const box = el.getBoundingClientRect()
          return [...el.querySelectorAll('.tz-chart, [data-testid^="tel-chart"]')]
            .map((c) => c.getBoundingClientRect())
            .filter((r) => r.height > 0 && (r.bottom > box.bottom + 1 || r.top < box.top - 1)).length
        })
        expect(hidden).toBe(0)
        expect(await panel.locator('.tz-chart, [data-testid^="tel-chart"]').count()).toBeGreaterThan(0)
      })
    }

    if (vp.touch) {
      test('tocar un coche lo selecciona; arrastrar el timeline con el dedo mueve el reloj', async ({ page }) => {
        await open(page)
        const { car, x, y } = await carOnScreen(page)
        await page.touchscreen.tap(x, y)
        await expect.poll(() => page.evaluate(() => window.__trazada!.selectedCar)).toBe(car)

        const box = (await page.getByTestId('timeline').boundingBox())!
        const { startMs, endMs } = await page.evaluate(() => ({ startMs: window.__trazada!.startMs, endMs: window.__trazada!.endMs }))
        const ty = box.y + box.height / 2
        const cdp = await page.context().newCDPSession(page)
        const touch = (type: string, tx: number) =>
          cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: tx, y: ty, id: 1 }] })
        await touch('touchStart', box.x + box.width * 0.2)
        for (const f of [0.35, 0.5, 0.65, 0.8]) await touch('touchMove', box.x + box.width * f)
        await touch('touchEnd', box.x + box.width * 0.8)
        const t = await page.evaluate(() => window.__trazada!.timeMs)
        expect(Math.abs(t - (startMs + 0.8 * (endMs - startMs)))).toBeLessThan((endMs - startMs) * 0.01)
      })
    }
  })
}

test.describe('girar la tablet', () => {
  test.use({ hasTouch: true })

  const camera = (page: Page) => page.evaluate(() => window.__trazada!.scene.camera)
  const close = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]!) <= Math.max(1, Math.abs(b[i]!) * 0.01))

  test('vertical → horizontal: la cámara vuelve a encuadrar el circuito como si se abriera en horizontal', async ({ browser }) => {
    const landscape = await browser.newPage({ viewport: { width: 1024, height: 768 }, hasTouch: true })
    await open(landscape)
    const expected = await camera(landscape)
    await landscape.close()

    const page = await browser.newPage({ viewport: { width: 768, height: 1024 }, hasTouch: true })
    await open(page)
    const portrait = await camera(page)
    expect(close(portrait, expected)).toBe(false)
    await page.setViewportSize({ width: 1024, height: 768 })
    await expect.poll(async () => close(await camera(page), expected), { timeout: 5000 }).toBe(true)
    await page.close()
  })

  test('si el usuario ha movido la cámara, girar no se la recoloca', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 })
    await open(page)
    const box = (await page.locator('[data-testid="scene"] canvas').boundingBox())!
    const x = box.x + box.width / 2
    const y = box.y + box.height / 3
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 120, y + 60, { steps: 8 })
    await page.mouse.up()
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    const moved = await camera(page)
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.waitForTimeout(500)
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    expect(close(await camera(page), moved)).toBe(true)
  })
})
