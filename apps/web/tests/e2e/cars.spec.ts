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

  // Una sigla que no tape otra (con los coches juntos, las etiquetas se solapan).
  const car = await page.evaluate(() => {
    for (const el of document.querySelectorAll<HTMLElement>('[data-testid="car-labels"] [data-car]')) {
      if (getComputedStyle(el).visibility !== 'visible') continue
      const r = el.getBoundingClientRect()
      if (document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === el) return el.dataset.car!
    }
    return null
  })
  expect(car).not.toBeNull()
  const label = page.locator(`[data-testid="car-labels"] [data-car="${car}"]`)
  await label.click()
  await expect.poll(() => page.evaluate(() => window.__trazada!.selectedCar)).toBe(car)
  await expect(label).toHaveAttribute('aria-pressed', 'true')
})

test.describe('coche 3D (D28)', () => {
  const follow = async (page: Page) => {
    await page.evaluate(() => window.__trazada!.seek(window.__trazada!.startMs + 85_828))
    await page.locator('[data-testid="leaderboard"] [data-car]').first().getByRole('button').click()
    await page.getByTestId('follow-toggle').click()
    await expect.poll(() => page.evaluate(() => window.__trazada!.scene.cameraMode), { timeout: 5000 }).toBe('follow')
  }
  const stats = (page: Page) => page.evaluate(() => ({ ...window.__trazada!.scene }))

  test('de lejos, cuñas; siguiendo a un coche, el modelo detallado, dentro del presupuesto de la escena', async ({ page }) => {
    await openScene(page)
    await page.evaluate(() => window.__trazada!.seek(window.__trazada!.startMs + 85_828))
    await expect.poll(async () => (await stats(page)).carLod.wedge).toBeGreaterThan(5)
    expect((await stats(page)).carLod.detail).toBe(0)
    await follow(page)
    await expect.poll(async () => (await stats(page)).carLod.detail).toBeGreaterThanOrEqual(1)
    const s = await stats(page)
    expect(s.carTriangles).toBeLessThanOrEqual(1600)
    // PLAN §2.5: < 30 draw calls y < 150 000 triángulos.
    expect(s.drawCalls).toBeLessThanOrEqual(13)
    expect(s.triangles).toBeLessThan(60_000)
  })

  test('con ?car=wedge, siempre la cuña (para comparar en el bench)', async ({ page }) => {
    await gotoApp(page, `${FP1}&car=wedge`)
    await expect.poll(async () => (await page.evaluate(() => window.__trazada?.scene.ready)) ?? false, { timeout: 15_000 }).toBe(true)
    await follow(page)
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    expect((await stats(page)).carLod.detail).toBe(0)
  })

  test('zoom de la cámara de seguimiento con la rueda (se recuerda); un clic en el coche lo deselecciona', async ({ page }) => {
    await openScene(page)
    await follow(page)
    const car = await page.evaluate(() => window.__trazada!.selectedCar)
    // Distancia horizontal de la cámara al coche (three: x, −y canónico).
    const distance = async () =>
      page.evaluate(() => {
        const [x, , z] = window.__trazada!.scene.camera
        const st = window.__trazada!.cars().find((c) => c.car === window.__trazada!.selectedCar)!
        return Math.hypot(x - st.x, z + st.y)
      })
    const far = await distance()
    const box = (await page.locator('[data-testid="scene"] canvas').boundingBox())!
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    await page.mouse.move(cx, cy)
    for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -120)
    await expect.poll(distance).toBeLessThan(far * 0.5)
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('trazada.settings') ?? '{}').followDistance)).toBeLessThan(35)
    // También con el ratón sobre la sigla del coche (que está encima del lienzo).
    const before = await distance()
    const label = (await page.locator(`[data-testid="car-labels"] [data-car="${car}"]`).boundingBox())!
    await page.mouse.move(label.x + label.width / 2, label.y + label.height / 2)
    for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 120)
    await expect.poll(distance).toBeGreaterThan(before * 1.3)
    for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -120)
    await page.mouse.move(cx, cy)
    // El coche ocupa el centro de la pantalla: un clic sobre él (proxy de selección) lo deselecciona.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    expect(car).not.toBeNull()
    await page.mouse.click(cx, cy + 20)
    await expect.poll(() => page.evaluate(() => window.__trazada!.selectedCar)).toBeNull()
  })

  test('mientras el seguimiento espera a ver el coche, la rueda es la del mapa (no cambia la distancia guardada)', async ({ page }) => {
    await openScene(page)
    // Al empezar la sesión no hay ningún coche en pista: el seguimiento queda a la espera.
    await page.evaluate(() => window.__trazada!.seek(window.__trazada!.startMs))
    await expect.poll(() => page.evaluate(() => window.__trazada!.cars().filter((c) => c.visible).length)).toBe(0)
    await page.locator('[data-testid="leaderboard"] [data-car]').first().getByRole('button').click()
    await page.getByTestId('follow-toggle').click()
    await expect.poll(() => page.evaluate(() => window.__trazada!.scene.cameraMode)).toBe('to-follow')
    const box = (await page.locator('[data-testid="scene"] canvas').boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    const before = await page.evaluate(() => window.__trazada!.scene.camera)
    for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -120)
    await expect.poll(() => page.evaluate(() => window.__trazada!.scene.camera)).not.toEqual(before) // zoom del mapa
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('trazada.settings') ?? '{}').followDistance)).toBeUndefined()
  })
})
