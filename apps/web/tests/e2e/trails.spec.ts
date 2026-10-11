/**
 * Estelas (ítem 7): apagadas por defecto; con «Equipo» o «Velocidad», una sola draw call para todos los coches dentro
 * del presupuesto de la escena; la punta de cada estela es su coche; se recuerdan al recargar; en pausa
 * no hay renders en bucle.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { gotoApp, settled } from './helpers'

const FP1 = '/replay?s=2026/10-spa-francorchamps/fp1'
/** Un minuto y medio dentro del extracto: coches en pista. */
const T_MS = 85_828

interface TrailStats {
  mode: 'off' | 'team' | 'speed'
  cars: number
  points: number
  noSample: number
  triangles: number
  drawCalls: number
  pointsPerCar: number
  spanMs: number
  heads: { car: string; x: number; y: number }[]
  /** Veces que se recalculó y subió la malla (solo con otro frame del runtime, modo, coche elegido o escala). */
  computes: number
}

const twoFrames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
const trails = (page: Page) => page.evaluate(() => window.__trazada!.scene.trails as TrailStats)
const scene = (page: Page) => page.evaluate(() => ({ ...window.__trazada!.scene }))

async function seek(page: Page, offsetMs: number) {
  await page.evaluate((t) => window.__trazada!.seek(window.__trazada!.startMs + t), offsetMs)
  await twoFrames(page)
}

/** Cada test tiene un contexto nuevo (almacenamiento vacío): sin `resetStorage`, que vaciaría también al recargar. */
async function openScene(page: Page) {
  await gotoApp(page, FP1)
  await expect.poll(async () => (await page.evaluate(() => window.__trazada?.scene.ready)) ?? false, { timeout: 15_000 }).toBe(true)
  await seek(page, T_MS)
  await expect.poll(() => page.evaluate(() => window.__trazada!.cars().filter((c) => c.visible).length)).toBeGreaterThan(5)
  await twoFrames(page)
}

/** Las estelas van en el menú «Capas» de las herramientas de escena: lo abre si está cerrado. */
async function openLayers(page: Page) {
  const button = page.getByTestId('tools-layers')
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click()
  await expect(page.getByTestId('trails-tool')).toBeVisible()
}

/** Espera a que el contador de renders deje de moverse (subida de geometría, ajustes de tamaño) y lo devuelve. */
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

test('apagadas por defecto; con Equipo o Velocidad, una draw call dentro del presupuesto; se recuerdan al recargar', async ({ page }) => {
  await openScene(page)
  await openLayers(page)
  await expect(page.getByTestId('trails-off')).toHaveAttribute('aria-pressed', 'true')
  const off = await trails(page)
  expect(off).toMatchObject({ mode: 'off', cars: 0, points: 0, drawCalls: 0, triangles: 0 })
  const base = await scene(page)
  expect(base.layers.find((l) => l.name === 'trails')).toMatchObject({ drawCalls: 0, triangles: 0 })

  await page.getByTestId('trails-team').click()
  await expect(page.getByTestId('trails-team')).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(async () => (await trails(page)).points).toBeGreaterThan(0)
  await twoFrames(page)
  const team = await trails(page)
  expect(team.mode).toBe('team')
  expect(team.drawCalls).toBe(1)
  expect(team.cars).toBeGreaterThan(5)
  expect(team.points).toBeLessThanOrEqual(team.cars * team.pointsPerCar)
  expect(team.triangles).toBeGreaterThan(0)
  expect(team.triangles).toBeLessThanOrEqual(team.cars * (team.pointsPerCar - 1) * 2)
  await expect(page.getByTestId('trails-legend')).toHaveCount(0)
  const on = await scene(page)
  // Una sola draw call para todas las estelas (la cámara no se ha movido y el reloj está en pausa).
  expect(on.drawCalls).toBe(base.drawCalls + 1)
  // Plan §5: tope de la escena base (13) más lo de cada capa activa, < 30 draw calls y < 150 000 triángulos.
  expect(on.drawCalls).toBeLessThanOrEqual(13 + on.layers.reduce((n, l) => n + l.drawCalls, 0))
  expect(on.drawCalls).toBeLessThan(30)
  expect(on.triangles).toBeLessThan(150_000)

  // Por navegador, con su versión de formato.
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('trazada.trails') ?? 'null'))).toEqual({ mode: 'team', _v: 1 })
  await page.reload()
  await expect.poll(async () => (await page.evaluate(() => window.__trazada?.scene.ready)) ?? false, { timeout: 15_000 }).toBe(true)
  await seek(page, T_MS)
  await expect(page.getByTestId('trails-team')).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(async () => (await trails(page)).points).toBeGreaterThan(0)

  await openLayers(page)
  await page.getByTestId('trails-speed').click()
  await expect(page.getByTestId('trails-legend')).toBeVisible()
  await expect(page.getByTestId('trails-legend')).toContainText(/80.330 km\/h/)
  await expect.poll(async () => (await trails(page)).mode).toBe('speed')
  const speed = await trails(page)
  expect(speed.points).toBeGreaterThan(0)
  expect(speed.drawCalls).toBe(1)
  // El fixture trae telemetría: la mayoría de puntos tienen velocidad medida; el resto, gris («sin dato»).
  expect(speed.noSample).toBeLessThan(speed.points)

  await page.getByTestId('trails-off').click()
  await expect.poll(async () => (await trails(page)).drawCalls).toBe(0)
  expect(await trails(page)).toMatchObject({ mode: 'off', points: 0, triangles: 0 })
  await expect(page.getByTestId('trails-legend')).toHaveCount(0)
})

test('la punta de cada estela es su coche, también tras un seek en pausa', async ({ page }) => {
  await openScene(page)
  await openLayers(page)
  await page.getByTestId('trails-team').click()
  await expect.poll(async () => (await trails(page)).points).toBeGreaterThan(0)
  for (const offset of [T_MS + 7000, T_MS - 20_000]) {
    await seek(page, offset)
    const [stats, cars] = await Promise.all([trails(page), page.evaluate(() => window.__trazada!.cars())])
    expect(stats.heads.length).toBe(stats.cars)
    expect(stats.cars).toBeGreaterThan(0)
    const byCar = new Map(cars.map((c) => [c.car, c]))
    for (const h of stats.heads) {
      const c = byCar.get(h.car)!
      expect(c.visible, h.car).toBe(true)
      expect(Math.hypot(h.x - c.x, h.y - c.y), h.car).toBeLessThan(0.01)
    }
  }
})

test('con estelas, en pausa no se renderiza ni se calcula en bucle (tampoco con la escena tapada); un seek sí', async ({ page }) => {
  await openScene(page)
  await openLayers(page)
  await page.getByTestId('trails-speed').click()
  await expect.poll(async () => (await trails(page)).points).toBeGreaterThan(0)
  /** Renders, mallas de estelas recalculadas y preparaciones de la escena (`useSceneFrame`). */
  const counters = () =>
    page.evaluate(() => {
      const s = window.__trazada!.scene
      return { renders: window.__trazada!.renders, computes: (s.trails as TrailStats).computes, prepared: (s.loop as { prepared: number }).prepared }
    })
  const before = await settledRenders(page)
  const idle = await counters()
  expect(idle.renders).toBe(before)
  await page.waitForTimeout(1000)
  expect(await counters()).toEqual(idle)

  // Con la hoja de análisis abierta la escena está tapada: nada se prepara ni se dibuja, aunque el bucle siga.
  await page.getByTestId('analysis-button').click()
  await expect(page.getByTestId('analysis-sheet')).toBeVisible()
  expect(await page.evaluate(() => window.__trazada!.sceneHidden)).toBe(true)
  const hidden = await counters()
  await page.waitForTimeout(1000)
  expect(await counters()).toEqual(hidden)
  await page.getByTestId('replay-title').click()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('analysis-sheet')).toHaveCount(0)
  await settledRenders(page)

  // Acercar el mapa en pausa vuelve a dibujar, pero no recalcula las estelas: la cámara no las cambia (anchura en el shader).
  const still = await counters()
  const box = (await page.locator('[data-testid="scene"] canvas').boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -120)
  await expect.poll(async () => (await counters()).renders).toBeGreaterThan(still.renders)
  expect((await counters()).computes).toBe(still.computes)

  // Un seek en pausa sí: otro frame del runtime.
  await page.evaluate(() => window.__trazada!.seek(window.__trazada!.timeMs + 5000))
  await expect.poll(async () => (await counters()).computes).toBeGreaterThan(still.computes)
  expect((await counters()).renders).toBeGreaterThan(still.renders)
})

test('la herramienta y su leyenda son accesibles; la pista explica qué es dato', async ({ page }) => {
  await openScene(page)
  // El menú «Capas»: botón con aria-expanded y, dentro, el grupo con su nombre.
  const menu = page.getByTestId('tools-layers')
  await expect(menu).toHaveAttribute('aria-expanded', 'false')
  await openLayers(page)
  await expect(menu).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('group', { name: /^(Capas|Layers)$/ })).toContainText(/(Estelas|Trails)/)
  await page.getByTestId('trails-speed').click()
  await page.getByTestId('trails-hint').click()
  await expect(page.getByTestId('trails-hint-panel')).toBeVisible()
  await expect(page.getByTestId('trails-hint-panel')).toContainText(/(línea central|centre line)/)
  await expect(page.getByTestId('trails-hint-panel')).toContainText(/(sin interpolar|not interpolated)/)
  await settled(page)
  const results = await new AxeBuilder({ page })
    .include('[data-testid="scene-tools"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)
  expect(serious).toEqual([])

  // Esc cierra primero la pista ⓘ (el menú sigue abierto) y después el menú, con el foco de vuelta en su botón.
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('trails-hint-panel')).toBeHidden()
  await expect(page.getByTestId('trails-tool')).toBeVisible()
  await page.getByTestId('trails-team').focus()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('trails-tool')).toBeHidden()
  await expect(menu).toHaveAttribute('aria-expanded', 'false')
  await expect(menu).toBeFocused()
})
