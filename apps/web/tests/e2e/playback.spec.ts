import { expect, type Page, test } from '@playwright/test'
import { gotoApp } from './helpers'

const FP1 = '/replay?s=2026/10-spa-francorchamps/fp1'

/** Evalúa `fn(window.__trazada)` en la página (las funciones no viajan como argumento). */
const handle = <T>(page: Page, fn: (h: NonNullable<Window['__trazada']>) => T) =>
  page.evaluate(`(${fn.toString()})(window.__trazada)`) as Promise<T>

async function openReplay(page: Page) {
  await gotoApp(page, FP1)
  await expect(page.getByTestId('replay-dock')).toBeVisible({ timeout: 15_000 })
  await page.locator('body').click({ position: { x: 5, y: 300 } }) // foco fuera de controles
}

/** Orden visible del leaderboard, una vez que no cambia entre dos lecturas separadas por 400 ms. */
async function stableOrder(page: Page): Promise<string[]> {
  const rows = page.locator('[data-testid="leaderboard"] [data-car]')
  const read = () => rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-car')!))
  let prev = await read()
  for (;;) {
    await page.waitForTimeout(400)
    const next = await read()
    if (next.length > 1 && next.join() === prev.join()) return next
    prev = next
  }
}

test.describe('atajos de teclado', () => {
  test('espacio, 1–5, ←/→ con y sin Shift, ↑/↓', async ({ page }) => {
    await openReplay(page)
    expect(await handle(page, (h) => h.playing)).toBe(false)
    await page.keyboard.press(' ')
    await expect.poll(() => handle(page, (h) => h.playing)).toBe(true)
    await page.keyboard.press(' ')
    await expect.poll(() => handle(page, (h) => h.playing)).toBe(false)

    for (const [key, rate] of [['3', 4], ['5', 16], ['2', 2], ['4', 8], ['1', 1]] as const) {
      await page.keyboard.press(key)
      await expect.poll(() => handle(page, (h) => h.rate)).toBe(rate)
    }
    await expect(page.getByTestId('rate-1')).toHaveAttribute('aria-pressed', 'true')

    const t0 = await handle(page, (h) => h.timeMs)
    await page.keyboard.press('ArrowRight')
    expect(await handle(page, (h) => h.timeMs)).toBe(t0 + 5000)
    await page.keyboard.press('Shift+ArrowRight')
    expect(await handle(page, (h) => h.timeMs)).toBe(t0 + 35_000)
    await page.keyboard.press('ArrowLeft')
    expect(await handle(page, (h) => h.timeMs)).toBe(t0 + 30_000)
    await page.keyboard.press('Shift+ArrowLeft')
    expect(await handle(page, (h) => h.timeMs)).toBe(t0)

    // ↑/↓ siguen el orden del leaderboard, que se publica cada 150 ms: se espera a que se asiente tras los seeks.
    const order = await stableOrder(page)
    await page.keyboard.press('ArrowDown')
    expect(await handle(page, (h) => h.selectedCar)).toBe(order[0])
    await page.keyboard.press('ArrowDown')
    expect(await handle(page, (h) => h.selectedCar)).toBe(order[1])
    await page.keyboard.press('ArrowUp')
    expect(await handle(page, (h) => h.selectedCar)).toBe(order[0])
  })

  test('no se disparan con el foco en un input o en el slider', async ({ page }) => {
    await openReplay(page)
    await page.evaluate(() => {
      const input = document.createElement('input')
      input.dataset.testid = 'probe-input'
      document.body.append(input)
    })
    await page.getByTestId('probe-input').focus()
    const t0 = await handle(page, (h) => h.timeMs)
    for (const key of [' ', '3', 'ArrowRight', 'ArrowDown']) await page.keyboard.press(key)
    expect(await handle(page, (h) => [h.playing, h.rate, h.timeMs, h.selectedCar])).toEqual([false, 1, t0, null])

    // En el slider: sus flechas mueven el tiempo una sola vez y el espacio no reproduce.
    await page.getByTestId('timeline').focus()
    await page.keyboard.press('ArrowRight')
    expect(await handle(page, (h) => h.timeMs)).toBe(t0 + 5000)
    await page.keyboard.press(' ')
    await page.keyboard.press('4')
    expect(await handle(page, (h) => [h.playing, h.rate])).toEqual([false, 1])
  })
})

test.describe('timeline', () => {
  test('arrastrar con el ratón mueve el reloj', async ({ page }) => {
    await openReplay(page)
    const box = (await page.getByTestId('timeline').boundingBox())!
    const { startMs, endMs } = await handle(page, (h) => ({ startMs: h.startMs, endMs: h.endMs }))
    const y = box.y + box.height / 2
    await page.mouse.move(box.x + box.width * 0.25, y)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.5, y, { steps: 5 })
    await page.mouse.move(box.x + box.width * 0.75, y, { steps: 5 })
    await page.mouse.up()
    const t = await handle(page, (h) => h.timeMs)
    expect(Math.abs(t - (startMs + 0.75 * (endMs - startMs)))).toBeLessThan((endMs - startMs) * 0.01)
  })

  // Desde 1280 px el timeline comparte fila con los controles (D44): si estos cambiaran de ancho con el reloj, el
  // instante bajo el puntero saltaría a mitad de un arrastre (el de arriba cruza la hora y el resumen del fixture).
  test('el timeline no cambia de ancho con el reloj: ni al pasar de la hora ni, arrastrando, al llegar el resumen', async ({
    page,
  }) => {
    await openReplay(page)
    const timeline = page.getByTestId('timeline')
    const { startMs, endMs } = await handle(page, (h) => ({ startMs: h.startMs, endMs: h.endMs }))
    const showMs = await page.evaluate(() => (window.__trazada!.scene.summary as { showMs: number }).showMs)
    const box = (await timeline.boundingBox())!
    /** Mismo sitio y ancho, salvo el redondeo de las fuentes (1/64 px). */
    const unchanged = async () => {
      const now = (await timeline.boundingBox())!
      expect(Math.abs(now.x - box.x)).toBeLessThan(0.5)
      expect(Math.abs(now.width - box.width)).toBeLessThan(0.5)
    }
    // Del principio (56:53 en el fixture) a justo antes del resumen: el reloj gana la hora y el timeline no se mueve.
    await page.evaluate((t) => window.__trazada!.seek(t), showMs - 2000)
    await expect(page.locator('[data-testid="time-readout"] .tz-readout__clock')).toHaveText(/^1:\d{2}:\d{2}$/)
    await unchanged()

    // Arrastrando por encima del momento del resumen: el botón espera a que se suelte y el instante sigue al puntero.
    const x = (ms: number) => box.x + ((ms - startMs) / (endMs - startMs)) * box.width
    const y = box.y + box.height / 2
    await page.mouse.move(x(showMs - 10_000), y)
    await page.mouse.down()
    await page.mouse.move(x(showMs + 60_000), y, { steps: 5 })
    await expect
      .poll(() => page.evaluate(() => (window.__trazada!.scene.summary as { available: boolean }).available))
      .toBe(true)
    await expect(page.getByTestId('summary-button')).toHaveCount(0)
    await unchanged()
    await page.mouse.move(x(showMs + 120_000), y, { steps: 3 })
    await page.mouse.up()
    expect(Math.abs((await handle(page, (h) => h.timeMs)) - (showMs + 120_000))).toBeLessThan((endMs - startMs) * 0.01)
    await expect(page.getByTestId('summary-button')).toBeVisible()
  })

  test('los marcadores pintados coinciden con los recuentos', async ({ page }) => {
    await openReplay(page)
    const m = await handle(page, (h) => ({
      laps: h.markers.laps.filter((l) => l.t >= h.startMs && l.t <= h.endMs).length,
      flags: h.markers.flags.filter((f) => f.t >= h.startMs && f.t <= h.endMs).length,
      pits: h.markers.pits.filter((p) => p.inMs >= h.startMs && p.inMs <= h.endMs).length,
    }))
    await expect(page.locator('[data-marker="lap"]')).toHaveCount(m.laps)
    await expect(page.locator('[data-marker="flag"]')).toHaveCount(m.flags)
    await expect(page.locator('[data-marker="pit"]')).toHaveCount(m.pits)
    expect(m.pits).toBeGreaterThan(0)
  })

  test('en pausa, un seek vuelve a renderizar la escena', async ({ page }) => {
    await openReplay(page)
    await expect(page.locator('[data-testid="scene"] canvas')).toBeVisible()
    await expect.poll(() => handle(page, (h) => h.renders)).toBeGreaterThan(0)
    // Se espera a que la escena se asiente (subida de geometría, ajustes de tamaño)…
    let before = -1
    await expect
      .poll(
        async () => {
          const now = await handle(page, (h) => h.renders)
          const stable = now === before
          before = now
          return stable
        },
        { intervals: [400], timeout: 10_000 },
      )
      .toBe(true)
    // …y desde ahí, en pausa, no se renderiza en bucle.
    await page.waitForTimeout(500)
    expect(await handle(page, (h) => h.renders)).toBe(before)
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => handle(page, (h) => h.renders)).toBeGreaterThan(before)
  })

  test('con prefers-reduced-motion las transiciones son instantáneas', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openReplay(page)
    const duration = await page
      .getByTestId('rate-2')
      .evaluate((el) => getComputedStyle(el).transitionDuration.split(',').map((d) => d.trim()))
    expect(duration.every((d) => d === '0s')).toBe(true)
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    const normal = await page.getByTestId('rate-2').evaluate((el) => getComputedStyle(el).transitionDuration)
    expect(normal).not.toBe('0s')
  })

  /**
   * Microinteracciones (21b, D42): con reduced motion, ninguna transición ni animación dura nada en todo el documento,
   * también tras elegir coche, plegar y desplegar la dirección de carrera, cambiar de diseño y hacer un seek.
   */
  test('con prefers-reduced-motion, transition-duration y animation-duration valen 0 s en todo el documento', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openReplay(page)
    await page.locator('[data-testid="leaderboard"] [data-car]').nth(2).getByRole('button').click()
    await expect(page.getByTestId('telemetry')).toBeVisible()
    await page.getByTestId('race-control-toggle').click()
    await page.getByTestId('race-control-toggle').click()
    await page.getByTestId('layout-analysis').click()
    await page.getByTestId('play-toggle').click()
    await page.waitForTimeout(300)
    await page.getByTestId('play-toggle').click()
    await page.evaluate(() => window.__trazada!.seek(window.__trazada!.startMs + 60_000))
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    const moving = await page.evaluate(() => {
      const out: string[] = []
      // `auto` es el valor inicial de animation-duration en los navegadores recientes (sin animación: nada que mover).
      const nonZero = (v: string) => v.split(',').some((d) => !['0s', 'auto', ''].includes(d.trim()))
      for (const el of document.querySelectorAll('*')) {
        const cs = getComputedStyle(el)
        if (nonZero(cs.transitionDuration) || nonZero(cs.animationDuration)) {
          out.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')}: ${cs.transitionDuration} / ${cs.animationDuration}`)
        }
      }
      return out.slice(0, 10)
    })
    expect(moving).toEqual([])
    await page.getByTestId('layout-spectator').click()
  })
})

test.describe('táctil', () => {
  test.use({ hasTouch: true })

  test('arrastrar con el dedo mueve el reloj', async ({ page }) => {
    await openReplay(page)
    const box = (await page.getByTestId('timeline').boundingBox())!
    const { startMs, endMs } = await handle(page, (h) => ({ startMs: h.startMs, endMs: h.endMs }))
    const y = box.y + box.height / 2
    const cdp = await page.context().newCDPSession(page)
    const touch = (type: string, x: number) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }],
      })
    await touch('touchStart', box.x + box.width * 0.2)
    for (const f of [0.3, 0.4, 0.5, 0.6]) await touch('touchMove', box.x + box.width * f)
    await touch('touchEnd', box.x + box.width * 0.6)
    const t = await handle(page, (h) => h.timeMs)
    expect(Math.abs(t - (startMs + 0.6 * (endMs - startMs)))).toBeLessThan((endMs - startMs) * 0.01)
  })
})
