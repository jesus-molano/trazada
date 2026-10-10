import { expect, type Page, test } from '@playwright/test'
import { gotoApp } from './helpers'

const FP1 = '/replay?s=2026/10-spa-francorchamps/fp1'

async function open(page: Page) {
  await gotoApp(page, FP1)
  await expect.poll(async () => (await page.evaluate(() => window.__trazada?.scene.ready)) ?? false, { timeout: 15_000 }).toBe(true)
  // Al inicio exacto del extracto aún no hay muestras: se avanza un minuto.
  await page.getByTestId('replay-title').click() // foco en la página sin tocar el lienzo (un clic ahí selecciona)
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('Shift+ArrowRight')
  await expect.poll(() => page.evaluate(() => window.__trazada!.cars().filter((c) => c.visible).length)).toBeGreaterThan(5)
  // El modelo se actualiza en el bucle del reloj y la escena (y las siglas) en el render siguiente.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
}

/** Centro en pantalla de un coche aislado (ninguna otra sigla a menos de 40 px), justo debajo de su sigla. */
async function carOnScreen(page: Page): Promise<{ car: string; x: number; y: number }> {
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

test('clic en el coche (raycast): panel de telemetría con DRS "no disponible en 2026" y gráficas', async ({ page }) => {
  await open(page)
  const { car, x, y } = await carOnScreen(page)
  await page.mouse.click(x, y)
  await expect.poll(() => page.evaluate(() => window.__trazada!.selectedCar)).toBe(car)
  const panel = page.getByTestId('telemetry')
  await expect(panel).toHaveAttribute('data-car', car)
  await expect(page.getByTestId('tel-drs-unavailable')).toContainText('2026')
  await expect(page.getByTestId('tel-drs')).toHaveCount(0)
  await expect(page.getByTestId('tel-speed')).not.toHaveText('—')
  await expect(panel.locator('canvas')).toHaveCount(2)
})

test('seguir con la cámara y volver con Esc; con el foco de un clic, el espacio reproduce', async ({ page }) => {
  await open(page)
  const overview = await page.evaluate(() => window.__trazada!.scene.camera)
  await page.locator('[data-testid="leaderboard"] [data-car]').nth(1).getByRole('button').click()
  await page.keyboard.press(' ')
  await expect.poll(() => page.evaluate(() => window.__trazada!.playing)).toBe(true)
  await page.keyboard.press(' ')
  await expect.poll(() => page.evaluate(() => window.__trazada!.selectedCar)).not.toBeNull()

  await page.getByTestId('follow-toggle').click()
  await expect.poll(() => page.evaluate(() => window.__trazada!.scene.cameraMode), { timeout: 5000 }).toBe('follow')
  // La cámara se lee del último render: se espera al siguiente tras el cambio de modo.
  const fromOverview = () =>
    page.evaluate((o) => {
      const c = window.__trazada!.scene.camera
      return Math.hypot(c[0]! - o[0]!, c[1]! - o[1]!, c[2]! - o[2]!)
    }, overview)
  await expect.poll(fromOverview).toBeGreaterThan(500)

  await page.keyboard.press('Escape')
  await expect.poll(() => page.evaluate(() => window.__trazada!.scene.cameraMode), { timeout: 5000 }).toBe('overview')
  await expect.poll(fromOverview).toBeLessThan(1)
  await page.keyboard.press('Escape')
  await expect.poll(() => page.evaluate(() => window.__trazada!.selectedCar)).toBeNull()
})

test('con prefers-reduced-motion, la vuelta a la vista general es instantánea', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await open(page)
  await page.locator('[data-testid="leaderboard"] [data-car]').first().getByRole('button').click()
  await page.getByTestId('follow-toggle').click()
  await expect.poll(() => page.evaluate(() => window.__trazada!.scene.cameraMode)).toBe('follow')
  await page.keyboard.press('Escape')
  expect(await page.evaluate(() => window.__trazada!.scene.cameraMode)).toBe('overview')
})
