/**
 * Comparar dos pilotos (ítem 1, D31) con el fixture de Spa (libres 1, extracto de 9 minutos): Mayús+clic en la
 * clasificación, diferencia en vivo en décimas con «Estimado», «sin dato» con su motivo cuando la vuelta de referencia
 * cae fuera de los datos, diferencia oficial al cerrar la vuelta, trazas por distancia y el fantasma (una draw call
 * dentro del presupuesto, sin niebla, sin renders en pausa), Esc con su prioridad y la preferencia del fantasma.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { gotoApp } from './helpers'

const FP1 = '/replay?s=2026/10-spa-francorchamps/fp1'

interface GhostStats {
  visible: boolean
  state: string
  car: string | null
  lap: number | null
  lod: 'wedge' | 'detail'
  x: number
  y: number
  t: number
  drawCalls: number
  triangles: number
  fogged: boolean
}

const twoFrames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
const ghost = (page: Page) => page.evaluate(() => window.__trazada!.scene.ghost as GhostStats)
const scene = (page: Page) => page.evaluate(() => ({ ...window.__trazada!.scene }))

/** Instante absoluto (ms de sesión) dentro del extracto (de 4 230 000 a 4 770 000). */
async function seekTo(page: Page, ms: number) {
  await page.evaluate((t) => window.__trazada!.seek(t), ms)
  await twoFrames(page)
}

async function openScene(page: Page) {
  await gotoApp(page, FP1)
  await expect.poll(async () => (await page.evaluate(() => window.__trazada?.scene.ready)) ?? false, { timeout: 15_000 }).toBe(true)
}

const row = (page: Page, car: string) => page.locator(`[data-testid="leaderboard"] [data-car="${car}"]`)

/** A seleccionado con un clic y B con Mayús+clic en la clasificación. */
async function compareCars(page: Page, a: string, b: string) {
  await row(page, a).getByRole('button').click()
  await expect(page.getByTestId('telemetry')).toHaveAttribute('data-car', a)
  await row(page, b).getByRole('button').click({ modifiers: ['Shift'] })
  await expect(page.getByTestId('compare-toggle')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('compare-car')).toHaveValue(b)
}

/** Espera a que el contador de renders deje de moverse y lo devuelve. */
async function settledRenders(page: Page): Promise<number> {
  let before = -1
  await expect
    .poll(
      async () => {
        const now = await page.evaluate(() => window.__trazada!.renders)
        const stable = now === before
        before = now
        return stable
      },
      { intervals: [400], timeout: 10_000 },
    )
    .toBe(true)
  return before
}

test('Mayús+clic compara; misma vuelta: diferencia en décimas con «Estimado», trazas y fantasma en una draw call', async ({ page }) => {
  await openScene(page)
  await seekTo(page, 4_470_000)
  await compareCars(page, '10', '23')
  // Las marcas «A» y «B» en la clasificación (con texto, no solo color).
  await expect(row(page, '10')).toHaveAttribute('data-compare', 'a')
  await expect(row(page, '23')).toHaveAttribute('data-compare', 'b')
  await expect(row(page, '23').getByTestId('compare-role')).toContainText('B')

  // En libres, la referencia por defecto es la mejor vuelta; aquí, la misma vuelta (la 22 de los dos).
  await expect(page.getByTestId('compare-ref')).toHaveValue('best')
  await page.getByTestId('compare-ref').selectOption('same')
  await twoFrames(page)
  const delta = page.getByTestId('compare-delta')
  await expect(delta).toHaveAttribute('data-state', 'ok')
  await expect(delta).toHaveText(/^[-−+]?\d+[.,]\d s$/)
  await expect(page.getByTestId('compare').locator('[data-testid="estimated"][data-field="lapDelta"]')).toBeVisible()
  await expect(page.getByTestId('compare-ref-info')).toContainText(/22.*ALB.*22/)
  // Tres gráficas por distancia con trazo.
  await expect(page.getByTestId('telemetry').locator('[data-testid^="compare-chart-"] canvas')).toHaveCount(3)

  // Otro instante de la misma vuelta (55 s después): otra diferencia (se escribe en el DOM en cada frame, sin Vue).
  const first = await delta.getAttribute('data-ms')
  await seekTo(page, 4_525_000)
  await expect(delta).toHaveAttribute('data-state', 'ok')
  await expect.poll(() => delta.getAttribute('data-ms')).not.toBe(first)

  // El fantasma: ALB en su vuelta 22 al mismo tiempo de vuelta (B ya la cerró, A aún no), una draw call, sin niebla.
  await expect.poll(async () => (await ghost(page)).visible).toBe(true)
  const g = await ghost(page)
  expect(g).toMatchObject({ car: '23', lap: 22, state: 'visible', drawCalls: 1, fogged: false })
  expect(g.t).toBeLessThan(4_525_000)
  await expect(page.getByTestId('compare-ghost-state')).toHaveAttribute('data-state', 'visible')
  const s = await scene(page)
  expect(s.layers.find((l) => l.name === 'ghost')).toMatchObject({ drawCalls: 1, fogged: false })
  // Plan §5: tope de la escena base (13) más lo de cada capa activa, < 30 draw calls y < 150 000 triángulos.
  expect(s.drawCalls).toBeLessThanOrEqual(13 + s.layers.reduce((n, l) => n + l.drawCalls, 0))
  expect(s.drawCalls).toBeLessThan(30)
  expect(s.triangles).toBeLessThan(150_000)
  for (const l of s.layers) expect(l.fogged, l.name).toBe(false)

  // Al cerrar los dos la vuelta 22: la diferencia oficial, con los tiempos de vuelta (114,436 − 115,235 s).
  await seekTo(page, 4_540_000)
  await expect(page.getByTestId('compare-official')).toContainText(/[-−]0[.,]799 s/)
})

test('la mejor vuelta de B cae fuera del extracto: «sin dato» con su motivo y sin fantasma; con la última vuelta, sí', async ({ page }) => {
  await openScene(page)
  await seekTo(page, 4_500_000)
  await compareCars(page, '16', '1')
  await expect(page.getByTestId('compare-ref')).toHaveValue('best')
  const delta = page.getByTestId('compare-delta')
  await expect(delta).toHaveAttribute('data-state', 'missing')
  await expect(delta).toHaveText(/^(Sin dato|No data)$/)
  await expect(page.getByTestId('compare-ref-info')).toHaveAttribute('data-missing', 'noPosition')
  await expect(page.getByTestId('compare-ref-info')).toContainText(/NOR/)
  await expect.poll(async () => (await ghost(page)).state).toBe('noPosition')
  expect(await ghost(page)).toMatchObject({ visible: false, drawCalls: 0 })

  await page.getByTestId('compare-ref').selectOption('last')
  await twoFrames(page)
  await expect(delta).toHaveAttribute('data-state', 'ok')
  await expect(page.getByTestId('compare-ref-info')).toContainText(/21.*NOR.*16/)
  await expect.poll(async () => (await ghost(page)).visible).toBe(true)
  expect((await ghost(page)).lap).toBe(16)
})

test('Esc cierra antes la comparación que la selección; el fantasma se apaga y se recuerda; sin renders en pausa', async ({ page }) => {
  await openScene(page)
  await seekTo(page, 4_470_000)
  await compareCars(page, '10', '23')
  await page.getByTestId('compare-ref').selectOption('same')
  await expect.poll(async () => (await ghost(page)).visible).toBe(true)

  // Con el fantasma a la vista, en pausa no se renderiza en bucle.
  const before = await settledRenders(page)
  await page.waitForTimeout(500)
  expect(await page.evaluate(() => window.__trazada!.renders)).toBe(before)

  await page.getByTestId('compare-ghost').click()
  await expect(page.getByTestId('compare-ghost')).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(async () => (await ghost(page)).drawCalls).toBe(0)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('trazada.compare') ?? 'null'))).toEqual({ showGhost: false, _v: 1 })
  await page.getByTestId('compare-ghost').click()
  await expect.poll(async () => (await ghost(page)).visible).toBe(true)

  // Esc: primero la comparación (vuelve «En vivo», el coche sigue elegido), después la selección.
  await page.getByTestId('replay-title').click()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('compare-toggle')).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByTestId('compare')).toHaveCount(0)
  await expect(page.getByTestId('tel-speed')).toBeVisible()
  expect(await page.evaluate(() => window.__trazada!.selectedCar)).toBe('10')
  await expect.poll(async () => (await ghost(page)).visible).toBe(false)
  await expect(row(page, '23')).not.toHaveAttribute('data-compare', /.+/)
  await page.keyboard.press('Escape')
  await expect.poll(() => page.evaluate(() => window.__trazada!.selectedCar)).toBeNull()
})

for (const viewport of [
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
]) {
  test(`${viewport.width}×${viewport.height}: la comparación cabe a lo ancho del panel (sin scroll horizontal)`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await openScene(page)
    await seekTo(page, 4_470_000)
    await row(page, '10').getByRole('button').click()
    // También siguiendo al coche: «Vista general» es el texto más largo de la cabecera.
    await page.getByTestId('follow-toggle').click()
    await row(page, '23').getByRole('button').click({ modifiers: ['Shift'] })
    await expect(page.getByTestId('compare-delta')).toBeVisible()
    const overflow = await page.evaluate(() => {
      const out = ['[data-testid="telemetry"]', '[data-testid="telemetry"] header']
        .flatMap((sel) => [...document.querySelectorAll(sel)])
        .filter((el) => el.scrollWidth > el.clientWidth)
        .map((el) => `${el.className} ${el.scrollWidth} > ${el.clientWidth}`)
        .concat(document.documentElement.scrollWidth > document.documentElement.clientWidth ? ['página'] : [])
      // Dentro de la comparación, cada elemento visible cabe en su caja. Se miden cajas y no `scrollWidth`: el área
      // táctil ampliada de los botones de icono (un ::after hasta --tz-hit-min) sobresale a propósito del botón de la
      // pista ⓘ del borde derecho, cae en el relleno del panel y ni es contenido ni da scroll (eso lo mide el panel).
      const cmp = document.querySelector('[data-testid="compare"]')!
      const box = cmp.getBoundingClientRect()
      for (const el of cmp.querySelectorAll('*')) {
        const r = el.getBoundingClientRect()
        if (r.width > 1 && (r.left < box.left - 0.5 || r.right > box.right + 0.5)) {
          out.push(`${el.tagName}.${String(el.className)} ${Math.round(r.left)}–${Math.round(r.right)} fuera de ${Math.round(box.left)}–${Math.round(box.right)}`)
        }
      }
      return out
    })
    expect(overflow).toEqual([])
  })
}

test('el panel de comparación es accesible (axe) y se elige B también con la lista', async ({ page }) => {
  await openScene(page)
  await seekTo(page, 4_470_000)
  await row(page, '10').getByRole('button').click()
  await page.getByTestId('compare-toggle').click()
  await expect(page.getByTestId('compare-empty')).toBeVisible()
  await page.getByTestId('compare-car').selectOption('23')
  await expect(page.getByTestId('compare-delta')).toBeVisible()
  await expect(row(page, '23')).toHaveAttribute('data-compare', 'b')
  const results = await new AxeBuilder({ page }).include('[data-testid="telemetry"]').analyze()
  expect(results.violations).toEqual([])
})
