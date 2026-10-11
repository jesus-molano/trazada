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
  // Las gráficas tienen trazo de verdad: los últimos 20 s ocupan casi todo el ancho (no solo un lienzo vacío).
  await expect
    .poll(() =>
      panel.locator('canvas').first().evaluate((c: HTMLCanvasElement) => {
        const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
        let minX = c.width
        let maxX = -1
        for (let y = 0; y < c.height; y++) {
          for (let x = 0; x < c.width; x++) {
            if (d[(y * c.width + x) * 4 + 3]! > 0) {
              minX = Math.min(minX, x)
              maxX = Math.max(maxX, x)
            }
          }
        }
        return maxX < 0 ? 0 : (maxX - minX) / c.width
      }),
    )
    .toBeGreaterThan(0.6)
  // «¿Por qué?»: el aviso del reglamento de 2026 en una pista flotante, sin mover las gráficas; Esc la cierra sin
  // deseleccionar el coche.
  const chartY = (await panel.locator('canvas').last().boundingBox())!.y
  await page.getByTestId('tel-drs-why').click()
  const why = page.getByTestId('tel-drs-why-panel')
  await expect(why).toBeVisible()
  await expect(why).toContainText('Boost')
  expect((await panel.locator('canvas').last().boundingBox())!.y).toBe(chartY)
  await page.keyboard.press('Escape')
  await expect(why).toBeHidden()
  expect(await page.evaluate(() => window.__trazada!.selectedCar)).toBe(car)
})

test('cabecera del panel: cerrar es un icono con nombre; seguir y comparar, placa maciza cuando están activos', async ({ page }) => {
  await open(page)
  await page.locator('[data-testid="leaderboard"] [data-car]').first().getByRole('button').click()
  const panel = page.getByTestId('telemetry')
  await expect(panel).toBeVisible()
  // Las cifras grandes de la muestra cruda: velocidad y marcha.
  await expect(page.getByTestId('tel-speed')).toHaveClass(/tz-num--xl/)
  await expect(page.getByTestId('tel-gear')).toHaveClass(/tz-num--xl/)
  // El color de equipo tiñe la cabecera, nunca el texto.
  const head = panel.locator('.tz-tel__head')
  expect(await head.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('gradient')
  const tla = panel.locator('.tz-tel__tla')
  expect(await tla.evaluate((el) => getComputedStyle(el).color)).toBe(await page.evaluate(() => getComputedStyle(document.body).color))

  // «Seguir»: con el texto y su icono; activo, una placa de pintura con el texto oscuro encima.
  const follow = page.getByTestId('follow-toggle')
  await expect(follow.locator('[data-icon="follow"]')).toBeVisible()
  const idle = await follow.evaluate((el) => getComputedStyle(el).backgroundColor)
  await follow.click()
  await expect(follow).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => follow.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(idle)
  await follow.click()
  await expect(follow).toHaveAttribute('aria-pressed', 'false')

  // Cerrar: un botón de icono (sin «×» suelto) con su nombre accesible.
  const close = page.getByTestId('telemetry-close')
  await expect(close).toHaveAccessibleName(/^(Cerrar telemetría|Close telemetry)$/)
  await expect(close.locator('[data-icon="close"]')).toBeVisible()
  expect((await close.textContent())!.trim()).toBe('')
  await close.click()
  await expect(panel).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => window.__trazada!.selectedCar)).toBeNull()
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

test('seguir a un coche sin señal: la cámara espera (no salta al origen) y arranca cuando el coche aparece', async ({ page }) => {
  await gotoApp(page, FP1)
  await expect.poll(async () => (await page.evaluate(() => window.__trazada?.scene.ready)) ?? false, { timeout: 15_000 }).toBe(true)
  await page.getByTestId('replay-title').click()
  // Al inicio exacto del extracto aún no hay muestras: se elige un coche oculto.
  const car = await page.evaluate(() => window.__trazada!.cars().find((c) => !c.visible)?.car ?? null)
  expect(car).not.toBeNull()
  await page.locator(`[data-testid="leaderboard"] [data-car="${car}"]`).getByRole('button').click()
  const overview = await page.evaluate(() => window.__trazada!.scene.camera)
  await page.getByTestId('follow-toggle').click()
  await page.waitForTimeout(1500)
  const still = await page.evaluate(() => window.__trazada!.scene.camera)
  expect(Math.hypot(still[0]! - overview[0]!, still[1]! - overview[1]!, still[2]! - overview[2]!)).toBeLessThan(1)
  expect(await page.evaluate(() => window.__trazada!.scene.cameraMode)).toBe('to-follow')
  // Cancelar mientras espera: la cámara no se mueve (no hay vista general guardada a la que volar).
  await page.keyboard.press('Escape')
  await expect.poll(() => page.evaluate(() => window.__trazada!.scene.cameraMode)).toBe('overview')
  await page.waitForTimeout(1200)
  const after = await page.evaluate(() => window.__trazada!.scene.camera)
  expect(Math.hypot(after[0]! - overview[0]!, after[1]! - overview[1]!, after[2]! - overview[2]!)).toBeLessThan(1)
  // Otra vez a seguir; en cuanto el coche tiene posición, empieza el seguimiento.
  await page.getByTestId('follow-toggle').click()
  await page.evaluate(() => window.__trazada!.seek(window.__trazada!.startMs + 60_000))
  await expect.poll(() => page.evaluate((c) => window.__trazada!.cars().find((x) => x.car === c)!.visible, car)).toBe(true)
  await expect.poll(() => page.evaluate(() => window.__trazada!.scene.cameraMode), { timeout: 5000 }).toBe('follow')
})

test('volver a seguir a mitad del regreso no pierde la vista general', async ({ page }) => {
  await open(page)
  const overview = await page.evaluate(() => window.__trazada!.scene.camera)
  const fromOverview = () =>
    page.evaluate((o) => {
      const c = window.__trazada!.scene.camera
      return Math.hypot(c[0]! - o[0]!, c[1]! - o[1]!, c[2]! - o[2]!)
    }, overview)
  await page.locator('[data-testid="leaderboard"] [data-car]').first().getByRole('button').click()
  const toggle = page.getByTestId('follow-toggle')
  await toggle.click()
  await expect.poll(() => page.evaluate(() => window.__trazada!.scene.cameraMode), { timeout: 5000 }).toBe('follow')
  await toggle.click() // vuelta a la vista general (0,9 s)…
  await page.waitForTimeout(250)
  expect(await page.evaluate(() => window.__trazada!.scene.cameraMode)).toBe('to-overview')
  await toggle.click() // …y a mitad, otra vez a seguir
  await expect.poll(() => page.evaluate(() => window.__trazada!.scene.cameraMode), { timeout: 5000 }).toBe('follow')
  await toggle.click()
  await expect.poll(() => page.evaluate(() => window.__trazada!.scene.cameraMode), { timeout: 5000 }).toBe('overview')
  await expect.poll(fromOverview).toBeLessThan(1)
})
