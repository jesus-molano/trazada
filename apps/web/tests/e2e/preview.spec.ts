/**
 * Vista previa del timeline (ítem 16) sobre el fixture (Spa 2026, libres 1): al pasar el ratón, una tarjeta con el
 * reloj, «Mejor vuelta» (nunca «Líder» fuera de carrera) igual que el primero de la clasificación en ese instante, el
 * estado de pista y los marcadores cercanos. Mirar no mueve el reloj ni pide renders a la escena. Con el dedo, mientras
 * arrastra; con el teclado, sobre el cabezal (Esc la oculta). Accesible (axe).
 */
import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { gotoApp, resetStorage } from './helpers'

const FP1 = '/replay?s=2026/10-spa-francorchamps/fp1'

const handle = <T>(page: Page, fn: (h: NonNullable<Window['__trazada']>) => T) =>
  page.evaluate(`(${fn.toString()})(window.__trazada)`) as Promise<T>

async function openReplay(page: Page) {
  await resetStorage(page)
  await gotoApp(page, FP1)
  await expect.poll(async () => (await page.evaluate(() => window.__trazada?.scene.ready)) ?? false, { timeout: 15_000 }).toBe(true)
}

const card = (page: Page) => page.getByTestId('timeline-preview')

/** Punto de la pista del timeline para el instante t (ms de sesión). */
async function pointAt(page: Page, t: number) {
  const box = (await page.getByTestId('timeline').boundingBox())!
  const { startMs, endMs } = await handle(page, (h) => ({ startMs: h.startMs, endMs: h.endMs }))
  return { x: box.x + (box.width * (t - startMs)) / (endMs - startMs), y: box.y + box.height / 2, msPerPx: (endMs - startMs) / box.width }
}

/** Primero de la clasificación en el instante t (con su posición conocida), tras asentarse (se publica cada 150 ms). */
async function leaderboardFirst(page: Page, t: number): Promise<string | null> {
  await page.evaluate((x) => window.__trazada!.seek(x), t)
  const first = page.locator('[data-testid="leaderboard"] [data-car]').first()
  let prev = ''
  for (;;) {
    await page.waitForTimeout(400)
    const now = `${await first.getAttribute('data-car')}|${await first.getAttribute('data-position-known')}`
    if (now === prev) return now.endsWith('|true') ? now.split('|')[0]! : null
    prev = now
  }
}

async function serious(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .exclude('[data-testid="scene"] canvas')
    .analyze()
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)
}

test('ratón: tarjeta del instante bajo el puntero, «Mejor vuelta» como la clasificación; mirar no mueve el reloj', async ({ page }) => {
  await openReplay(page)
  const t0 = await handle(page, (h) => h.timeMs)
  const { startMs, endMs } = await handle(page, (h) => ({ startMs: h.startMs, endMs: h.endMs }))
  const target = startMs + 0.4 * (endMs - startMs)
  const p = await pointAt(page, target)
  await page.mouse.move(p.x, p.y)
  await expect(card(page)).toBeVisible()
  const t = Number(await card(page).getAttribute('data-t'))
  expect(Math.abs(t - target)).toBeLessThan(2 * p.msPerPx)
  expect(await handle(page, (h) => h.timeMs)).toBe(t0)

  // Libres: se rotula «Mejor vuelta», nunca «Líder»; el reloj visible, sin vuelta de sesión.
  await expect(card(page)).toHaveAttribute('data-role', 'bestLap')
  await expect(page.getByTestId('preview-leader')).toContainText(/^(Mejor vuelta|Best lap)/)
  await expect(page.getByTestId('preview-leader')).not.toContainText(/(Líder|Leader)/)
  await expect(page.getByTestId('preview-when')).toHaveText(/^−?\d+:\d\d(:\d\d)?$/)
  // La pista la describe la tarjeta (aria-describedby) mientras se ve.
  const id = await card(page).getAttribute('id')
  await expect(page.getByTestId('timeline')).toHaveAttribute('aria-describedby', id!)

  // El mismo primero que la clasificación en ese instante (o «sin dato» en la tarjeta).
  const leader = await card(page).getAttribute('data-leader')
  const first = await leaderboardFirst(page, t)
  if (leader) {
    expect(leader).toBe(first)
    const tla = await handle(page, (h) => h.drivers.map((d) => [d.number, d.tla]))
    await expect(page.getByTestId('preview-leader-name')).toHaveText(new Map(tla as [string, string][]).get(leader)!)
  } else {
    await expect(page.getByTestId('preview-leader-nodata')).toBeVisible()
  }

  // Al salir de la pista, se oculta.
  await page.mouse.move(p.x, p.y - 200)
  await expect(card(page)).toBeHidden()
  await expect(page.getByTestId('timeline')).not.toHaveAttribute('aria-describedby', /.+/)
})

test('cerca de una bandera: el marcador y el chip de estado de ese instante, sin tocar la cabecera', async ({ page }) => {
  await openReplay(page)
  const flag = await handle(page, (h) =>
    h.markers.flags.find((f) => f.kind === 'sector_double_yellow' && f.t >= h.startMs && f.t <= h.endMs) ?? null,
  )
  expect(flag).not.toBeNull()
  // 2 s después del mensaje: la doble amarilla del sector sigue activa y el marcador está a menos de 8 px.
  const p = await pointAt(page, flag!.t + 2000)
  expect(2000 / p.msPerPx).toBeLessThan(8)
  await page.mouse.move(p.x, p.y)
  await expect(card(page)).toBeVisible()
  await expect(page.locator(`[data-testid="preview-sector"][data-sector="${flag!.sector}"]`)).toHaveAttribute(
    'data-flag',
    'DOUBLE YELLOW',
  )
  await expect(page.getByTestId('preview-markers')).toContainText(new RegExp(`(Doble amarilla|Double yellow) · sector ${flag!.sector}`))
  // La cabecera sigue con el instante del reloj (al inicio no hay bandera en ese sector) y sin ids repetidos.
  await expect(page.locator(`[data-testid="track-sector"][data-sector="${flag!.sector}"]`)).toHaveCount(0)
  expect(await serious(page)).toEqual([])
})

test('con la hoja de análisis abierta, la tarjeta sale por encima de la hoja (nada la tapa)', async ({ page }) => {
  await openReplay(page)
  await page.getByTestId('analysis-button').click()
  await expect(page.getByTestId('analysis-sheet')).toBeVisible()
  const { startMs, endMs } = await handle(page, (h) => ({ startMs: h.startMs, endMs: h.endMs }))
  const p = await pointAt(page, startMs + 0.5 * (endMs - startMs))
  await page.mouse.move(p.x, p.y)
  await expect(card(page)).toBeVisible()
  const sheetBox = (await page.getByTestId('analysis-sheet').boundingBox())!
  const c = (await card(page).boundingBox())!
  // La tarjeta sube por encima del dock, sobre la hoja (si no, este test no probaría nada).
  expect(c.y).toBeLessThan(sheetBox.y + sheetBox.height)
  // Lo que se ve en cada esquina de la tarjeta es la tarjeta (sin `pointer-events: none` solo para preguntarlo).
  const topmost = await card(page).evaluate((el) => {
    const e = el as HTMLElement
    e.style.pointerEvents = 'auto'
    const r = e.getBoundingClientRect()
    const corners = [
      [r.left + 2, r.top + 2],
      [r.right - 2, r.top + 2],
      [r.left + 2, r.bottom - 2],
      [r.right - 2, r.bottom - 2],
    ]
    const ok = corners.every(([x, y]) => e.contains(document.elementFromPoint(x!, y!)))
    e.style.pointerEvents = ''
    return ok
  })
  expect(topmost).toBe(true)
})

test('mirar el timeline en pausa no pide renders a la escena', async ({ page }) => {
  await openReplay(page)
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
  const box = (await page.getByTestId('timeline').boundingBox())!
  for (const f of [0.1, 0.3, 0.5, 0.7, 0.9]) await page.mouse.move(box.x + box.width * f, box.y + box.height / 2, { steps: 4 })
  await expect(card(page)).toBeVisible()
  await page.waitForTimeout(300)
  expect(await handle(page, (h) => h.renders)).toBe(before)
})

test('teclado: con el foco, tarjeta sobre el cabezal que sigue a las flechas; Esc la oculta sin perder el foco', async ({ page }) => {
  await openReplay(page)
  await page.getByTestId('replay-title').click()
  // Tab hasta el timeline (foco de teclado, como lo haría una persona).
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press('Tab')
    if (await page.getByTestId('timeline').evaluate((el) => el === document.activeElement)) break
  }
  await expect(page.getByTestId('timeline')).toBeFocused()
  await expect(card(page)).toBeVisible()
  const t0 = await handle(page, (h) => h.timeMs)
  await expect(card(page)).toHaveAttribute('data-t', String(Math.round(t0)))
  await page.keyboard.press('ArrowRight')
  await expect(card(page)).toHaveAttribute('data-t', String(Math.round(t0 + 5000)))
  await page.keyboard.press('Escape')
  await expect(card(page)).toBeHidden()
  await expect(page.getByTestId('timeline')).toBeFocused()
  // Vuelve con la siguiente tecla.
  await page.keyboard.press('ArrowLeft')
  await expect(card(page)).toHaveAttribute('data-t', String(Math.round(t0)))
})

test.describe('táctil', () => {
  test.use({ hasTouch: true })

  test('dedo: la tarjeta sale al tocar, sigue al arrastrar (y el reloj con ella) y se va al soltar', async ({ page }) => {
    await openReplay(page)
    const box = (await page.getByTestId('timeline').boundingBox())!
    const y = box.y + box.height / 2
    const cdp = await page.context().newCDPSession(page)
    const touch = (type: string, x: number) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] })
    await touch('touchStart', box.x + box.width * 0.2)
    await expect(card(page)).toBeVisible()
    for (const f of [0.3, 0.4, 0.5]) await touch('touchMove', box.x + box.width * f)
    await expect
      .poll(async () => Math.abs(Number(await card(page).getAttribute('data-t')) - (await handle(page, (h) => h.timeMs))))
      .toBeLessThan(((await handle(page, (h) => h.endMs - h.startMs)) / box.width) * 2)
    // La tarjeta queda encima del dedo y dentro de la pista.
    const c = (await card(page).boundingBox())!
    expect(c.y + c.height).toBeLessThanOrEqual(box.y + 1)
    expect(c.x).toBeGreaterThanOrEqual(box.x - 1)
    expect(c.x + c.width).toBeLessThanOrEqual(box.x + box.width + 1)
    await touch('touchEnd', box.x + box.width * 0.5)
    await expect(card(page)).toBeHidden()
  })
})
