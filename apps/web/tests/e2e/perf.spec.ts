import { expect, type Page, test } from '@playwright/test'
import { gotoApp } from './helpers'

declare global {
  interface Window {
    __longTasks: { start: number; duration: number }[]
  }
}

const FP1 = '/replay?s=2026/10-spa-francorchamps/fp1'
const twoFrames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
const scene = (page: Page) => page.evaluate(() => ({ ...window.__trazada!.scene }))
const layer = (page: Page, name: string) =>
  page.evaluate((n) => window.__trazada!.scene.layers.find((l) => l.name === n) ?? null, name)

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

/** Abre el menú «Capas» de las herramientas de escena si está cerrado. */
async function openLayers(page: Page) {
  const button = page.getByTestId('tools-layers')
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click()
  await expect(page.getByTestId('heat-tool')).toBeVisible()
}

test('de clic a "listo" sin long tasks > 50 ms en el hilo principal (CPU ×4)', async ({ page }) => {
  await page.addInitScript(() => {
    window.__longTasks = []
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__longTasks.push({ start: e.startTime, duration: e.duration })
    }).observe({ type: 'longtask', buffered: true })
  })
  await gotoApp(page, '/?season=2026&event=10-spa-francorchamps')
  await expect(page.getByTestId('session-fp1')).toBeVisible()
  // Deja que termine el trabajo inicial de la página (hidratación, fuentes) antes de medir.
  await page.waitForTimeout(500)

  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  const clickAt = await page.evaluate(() => performance.now())
  await page.getByTestId('session-fp1').click()
  await expect(page.getByTestId('replay-status')).toHaveAttribute('data-state', 'ready', { timeout: 30_000 })
  // Fin de la ventana: la marca que pone la app al quedar lista (no cuando Playwright lo detecta, que
  // ya incluiría el montaje de la escena, que va después).
  const readyAt = await page.evaluate(() => performance.getEntriesByName('trazada:ready').at(-1)!.startTime)
  await page.waitForTimeout(1000)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })

  const tasks = await page.evaluate(() => window.__longTasks)
  const inWindow = tasks.filter((t) => t.start + t.duration > clickAt && t.start < readyAt)
  const after = tasks.filter((t) => t.start >= readyAt)
  console.log(
    `clic→listo ${Math.round(readyAt - clickAt)} ms (CPU ×4); long tasks: ${JSON.stringify(inWindow)}; ` +
      `tras "listo" (montaje de la escena): ${JSON.stringify(after.map((t) => Math.round(t.duration)))}`,
  )
  expect(inWindow.filter((t) => t.duration > 50)).toEqual([])
})

/**
 * Escenario «todas las capas» (plan §5, al cerrar la Tanda 4): estelas, mapa de calor (minisectores) y fantasma de la
 * comparación a la vez, sobre Spa FP1. Las zonas de DRS no existen en 2026 (no hay
 * dato), así que esa capa no suma aquí; su coste se mide con una sesión de 2018–2025 (bench local). Lo que se exige es
 * determinista: presupuesto de escena (< 30 draw calls, < 150 000 triángulos) y nada de renders en pausa. Los tiempos de frame con CPU ×4 («iPad aproximado») solo se anotan: CI no tiene GPU.
 */
test('todas las capas: presupuesto de escena, sin renders en pausa; frames con CPU ×4 anotados', async ({ page }) => {
  await gotoApp(page, FP1)
  await expect.poll(async () => (await page.evaluate(() => window.__trazada?.scene.ready)) ?? false, { timeout: 15_000 }).toBe(true)
  // GAS va por su vuelta 22 y ALB ya la cerró (como compare.spec.ts); los dos tienen entera y con posiciones su vuelta 21.
  await page.evaluate(() => window.__trazada!.seek(4_525_000))
  await twoFrames(page)

  // A = GAS, B = ALB (Mayús+clic) en la misma vuelta: fantasma a la vista.
  const row = (car: string) => page.locator(`[data-testid="leaderboard"] [data-car="${car}"]`)
  await row('10').getByRole('button').click()
  await expect(page.getByTestId('telemetry')).toHaveAttribute('data-car', '10')
  await row('23').getByRole('button').click({ modifiers: ['Shift'] })
  await expect(page.getByTestId('compare-toggle')).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('compare-ref').selectOption('same')

  await openLayers(page)
  await page.getByTestId('trails-team').click()
  // Minisectores de la última vuelta válida de cada uno (la 21 de los dos).
  await page.getByTestId('heat-minisectors').click()
  await page.getByTestId('heat-pick-last').click()
  await expect(page.getByTestId('heat-tool')).toHaveAttribute('data-status', 'ok')

  for (const name of ['trails', 'heat', 'ghost']) {
    await expect.poll(async () => (await layer(page, name))?.drawCalls ?? 0, { message: name }).toBeGreaterThan(0)
  }
  await twoFrames(page)
  const all = await scene(page)
  console.log(
    `todas las capas: ${all.drawCalls} draw calls, ${all.triangles} triángulos; ` +
      all.layers.map((l) => `${l.name} ${l.drawCalls}/${l.triangles}`).join(', '),
  )
  expect(all.drawCalls).toBeLessThanOrEqual(13 + all.layers.reduce((n, l) => n + l.drawCalls, 0))
  expect(all.drawCalls).toBeLessThan(30)
  expect(all.triangles).toBeLessThan(150_000)

  // En pausa, con todo encendido, no se renderiza ni se prepara nada en bucle (`useSceneFrame`): las estelas no se
  // recalculan. Tampoco con la hoja de análisis tapando la escena.
  const idle = () =>
    page.evaluate(() => {
      const s = window.__trazada!.scene
      return {
        renders: window.__trazada!.renders,
        prepared: (s.loop as { prepared: number }).prepared,
        trails: (s.trails as { computes: number }).computes,
      }
    })
  // Sin el mensajero de las devtools de TresJS, su muestreo no recorre la escena en cada frame (build de producción).
  expect(await page.evaluate(() => '__TRES__DEVTOOLS__' in window)).toBe(false)
  const before = await settledRenders(page)
  const paused = await idle()
  await page.waitForTimeout(1000)
  expect(await idle()).toEqual(paused)
  await page.getByTestId('analysis-button').click()
  await expect(page.getByTestId('analysis-sheet')).toBeVisible()
  const covered = await idle()
  await page.waitForTimeout(1000)
  expect(await idle()).toEqual(covered)
  await page.getByTestId('replay-title').click()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('analysis-sheet')).toHaveCount(0)

  // «iPad aproximado»: CPU ×4 y reproducción a ×1 durante 3 s; intervalos entre frames, solo anotados.
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  await page.getByTestId('replay-title').click()
  await page.keyboard.press(' ')
  await expect.poll(() => page.evaluate(() => window.__trazada!.playing)).toBe(true)
  const frames = await page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const out: number[] = []
        let last = performance.now()
        const end = last + 3000
        const tick = (now: number) => {
          out.push(now - last)
          last = now
          if (now < end) requestAnimationFrame(tick)
          else resolve(out)
        }
        requestAnimationFrame(tick)
      }),
  )
  await page.keyboard.press(' ')
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  const sorted = [...frames].sort((a, b) => a - b)
  const p = (q: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!)
  console.log(`todas las capas, CPU ×4, ×1: ${frames.length} frames en 3 s; p50 ${p(0.5)} ms, p95 ${p(0.95)} ms, máx ${p(1)} ms`)
  // Mientras reproduce, la escena se sigue dibujando (el número no se valora: sin GPU).
  expect(await page.evaluate(() => window.__trazada!.renders)).toBeGreaterThan(before)
})
