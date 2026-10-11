/**
 * Realización automática (ítem 9, D39) con el fixture (Spa, libres 1: sin intervalos en la torre ni curvas numeradas).
 * Se enciende desde el menú «Cámara» o con la T; elige dos coches cerca en pista y el chip no da ninguna cifra; corta
 * como mucho cada 6 s; en pausa no renderiza en bucle; dentro del presupuesto de la escena; cualquier acción manual la
 * apaga (arrastrar el mapa deja la cámara donde está, con los controles; Esc vuelve a la vista general; elegir o seguir
 * un coche); con reduced motion, solo cortes. En tablet, el botón de la cabecera y un toque en la escena.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { gotoApp, settled } from './helpers'

const FP1 = '/replay?s=2026/10-spa-francorchamps/fp1'
/**
 * Dos minutos y medio dentro del extracto: coches en pista y, entre 136 y 168 s, ALB y NOR a menos de 1 s el uno del
 * otro (a 85 s, en cambio, ninguna pareja está tan cerca y tocaría la vista general).
 */
const T_MS = 150_000

interface TvStats {
  active: boolean
  shot: { id: number; kind: 'duel' | 'leader' | 'overview'; cars: string[]; basis: 'tower' | 'proximity' | null; reason: string } | null
  camera: 'chase' | 'corner' | 'overview'
  corner: number | null
  intervalMs: number | null
  cuts: number[]
  cams: number
  camsFrom: 'corners' | 'curvature'
}

const twoFrames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
const tv = (page: Page) => page.evaluate(() => window.__trazada!.scene.tv as TvStats)
const mode = (page: Page) => page.evaluate(() => window.__trazada!.scene.cameraMode)
const camera = (page: Page) => page.evaluate(() => window.__trazada!.scene.camera)
const scene = (page: Page) => page.evaluate(() => ({ ...window.__trazada!.scene }))
const dist = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!)

async function openScene(page: Page) {
  await gotoApp(page, FP1)
  await expect.poll(async () => (await page.evaluate(() => window.__trazada?.scene.ready)) ?? false, { timeout: 15_000 }).toBe(true)
  await page.evaluate((t) => window.__trazada!.seek(window.__trazada!.startMs + t), T_MS)
  await expect.poll(() => page.evaluate(() => window.__trazada!.cars().filter((c) => c.visible).length)).toBeGreaterThan(5)
  await twoFrames(page)
  // Foco en la página sin tocar el lienzo (un clic ahí selecciona un coche o apagaría la realización).
  await page.getByTestId('replay-title').click()
}

/** Abre el menú «Cámara» de las herramientas de escena y enciende la realización con «Sí». */
async function startFromMenu(page: Page) {
  const menu = page.getByTestId('tools-camera')
  if ((await menu.getAttribute('aria-expanded')) !== 'true') await menu.click()
  await expect(page.getByTestId('tv-tool')).toBeVisible()
  await page.getByTestId('tv-on').click()
  await expect.poll(() => mode(page), { timeout: 5000 }).toBe('tv')
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

/** Un punto del lienzo sin nada encima (ni siglas ni paneles), lejos de los bordes. */
async function canvasPoint(page: Page): Promise<{ x: number; y: number }> {
  const p = await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="scene"] canvas')!
    const r = canvas.getBoundingClientRect()
    for (let fy = 0.45; fy <= 0.75; fy += 0.05) {
      for (let fx = 0.35; fx <= 0.65; fx += 0.05) {
        const x = r.left + r.width * fx
        const y = r.top + r.height * fy
        const free = [-20, 0, 20].every((d) => document.elementFromPoint(x + d, y + d) === canvas)
        if (free) return { x, y }
      }
    }
    return null
  })
  expect(p).not.toBeNull()
  return p!
}

test('desde el menú «Cámara»: sigue a dos coches cerca en pista, sin cifra, dentro del presupuesto de la escena', async ({ page }) => {
  await openScene(page)
  const overview = await camera(page)
  await startFromMenu(page)
  const s = await tv(page)
  expect(s.active).toBe(true)
  // Libres sin intervalos: un duelo por cercanía en pista, sin intervalo.
  expect(s.shot).toMatchObject({ kind: 'duel', basis: 'proximity' })
  expect(s.intervalMs).toBeNull()
  expect(s.camera).toBe('chase')
  // Sin curvas numeradas en el fixture: cámaras fijas en los picos de curvatura.
  expect(s.camsFrom).toBe('curvature')
  expect(s.cams).toBeGreaterThan(0)
  // Los dos coches del plano, a la vista, cerca en pista y la cámara cerca de ellos (no en la vista general).
  const cars = await page.evaluate(() => window.__trazada!.cars())
  const [a, b] = s.shot!.cars.map((c) => cars.find((x) => x.car === c)!)
  expect(a!.visible && b!.visible).toBe(true)
  expect(Math.hypot(a!.x - b!.x, a!.y - b!.y)).toBeLessThan(150)
  const cam = await camera(page)
  expect(Math.hypot(cam[0]! - (a!.x + b!.x) / 2, cam[2]! + (a!.y + b!.y) / 2)).toBeLessThan(250)
  expect(dist(cam, overview)).toBeGreaterThan(300)

  // El chip: a quién sigue, «cerca en pista» y ningún número.
  const chip = page.getByTestId('tv-chip')
  await expect(chip).toBeVisible()
  await expect(page.getByTestId('tv-chip-text')).toHaveText(/(cerca en pista|close on track)/)
  expect(await page.getByTestId('tv-chip-text').textContent()).not.toMatch(/\d/)
  await expect(page.getByTestId('tv-chip-text')).toHaveAttribute('title', /(no se da cifra|no figure is given)/)

  // Plan §5: < 30 draw calls y < 150 000 triángulos; tope de la escena base (13) más las capas activas.
  await twoFrames(page)
  const st = await scene(page)
  expect(st.drawCalls).toBeLessThanOrEqual(13 + st.layers.reduce((n, l) => n + l.drawCalls, 0))
  expect(st.drawCalls).toBeLessThan(30)
  expect(st.triangles).toBeLessThan(150_000)
})

test('en pausa no renderiza en bucle; un seek elige plano de cero al momento', async ({ page }) => {
  await openScene(page)
  await page.keyboard.press('t')
  await expect.poll(() => mode(page), { timeout: 5000 }).toBe('tv')
  const before = await settledRenders(page)
  await page.waitForTimeout(600)
  expect(await page.evaluate(() => window.__trazada!.renders)).toBe(before)
  const shot = (await tv(page)).shot!
  await page.evaluate(() => window.__trazada!.seek(window.__trazada!.timeMs + 60_000))
  await expect.poll(async () => (await tv(page)).shot!.id).toBeGreaterThan(shot.id)
  expect((await tv(page)).active).toBe(true)
  await expect.poll(() => page.evaluate(() => window.__trazada!.renders)).toBeGreaterThan(before)
})

test('nunca corta más rápido que cada 6 s (×4, 14 s de reproducción)', async ({ page }) => {
  await openScene(page)
  await page.keyboard.press('t')
  await expect.poll(() => mode(page), { timeout: 5000 }).toBe('tv')
  await page.keyboard.press('3') // ×4
  await page.keyboard.press(' ')
  await expect.poll(() => page.evaluate(() => window.__trazada!.playing)).toBe(true)
  await page.waitForTimeout(14_000)
  await page.keyboard.press(' ')
  const { cuts, active } = await tv(page)
  expect(active).toBe(true)
  expect(cuts.length).toBeGreaterThanOrEqual(1)
  for (let i = 1; i < cuts.length; i++) expect(cuts[i]! - cuts[i - 1]!).toBeGreaterThanOrEqual(6000 - 1)
})

test('arrastrar el mapa la apaga y deja la cámara donde está, con los controles del mapa', async ({ page }) => {
  await openScene(page)
  const overview = await camera(page)
  await page.keyboard.press('t')
  await expect.poll(() => mode(page), { timeout: 5000 }).toBe('tv')
  await settledRenders(page)
  const tvPose = await camera(page)
  const p = await canvasPoint(page)
  await page.mouse.move(p.x, p.y)
  await page.mouse.down()
  for (let i = 1; i <= 6; i++) await page.mouse.move(p.x + i * 20, p.y + i * 8)
  await page.mouse.up()
  await expect.poll(async () => (await tv(page)).active).toBe(false)
  expect(await mode(page)).toBe('overview')
  await expect(page.getByTestId('tv-chip')).toHaveCount(0)
  // El mismo gesto ya mueve el mapa (los controles se encienden antes de que les llegue), sin volar a la vista general.
  await expect.poll(async () => dist(await camera(page), tvPose)).toBeGreaterThan(0.5)
  const after = await camera(page)
  expect(dist(after, tvPose)).toBeLessThan(400)
  expect(dist(after, overview)).toBeGreaterThan(300)
})

test('Esc la apaga y vuelve a la vista general; elegir un coche la apaga; seguirlo, también', async ({ page }) => {
  await openScene(page)
  const overview = await camera(page)
  await page.keyboard.press('t')
  await expect.poll(() => mode(page), { timeout: 5000 }).toBe('tv')
  await page.keyboard.press('Escape')
  await expect.poll(() => mode(page), { timeout: 5000 }).toBe('overview')
  await expect.poll(async () => dist(await camera(page), overview)).toBeLessThan(1)
  expect((await tv(page)).active).toBe(false)

  // Elegir un coche la apaga (y vuelve a la vista general).
  await page.keyboard.press('t')
  await expect.poll(() => mode(page), { timeout: 5000 }).toBe('tv')
  // Uno de los coches del plano: está en pista (después se le puede seguir sin esperar a que aparezca).
  const car = (await tv(page)).shot!.cars[0]!
  await page.locator(`[data-testid="leaderboard"] [data-car="${car}"]`).getByRole('button').click()
  await expect.poll(async () => (await tv(page)).active).toBe(false)
  await expect.poll(() => mode(page), { timeout: 5000 }).toBe('overview')
  expect(await page.evaluate(() => window.__trazada!.selectedCar)).toBe(car)

  // Con el coche elegido: la T la enciende (la selección se queda) y «Seguir» la apaga y sigue al coche.
  await page.getByTestId('replay-title').click()
  await page.keyboard.press('t')
  await expect.poll(() => mode(page), { timeout: 5000 }).toBe('tv')
  expect(await page.evaluate(() => window.__trazada!.selectedCar)).not.toBeNull()
  await page.getByTestId('follow-toggle').click()
  await expect.poll(async () => (await tv(page)).active).toBe(false)
  await expect.poll(() => mode(page), { timeout: 5000 }).toBe('follow')
})

test('el chip y la herramienta son accesibles; «Salir» la apaga', async ({ page }) => {
  await openScene(page)
  await startFromMenu(page)
  await page.getByTestId('tv-hint').click()
  await expect(page.getByTestId('tv-hint-panel')).toContainText(/(torre de tiempos oficial|official timing tower)/)
  await settled(page)
  const results = await new AxeBuilder({ page })
    .include('[data-testid="scene-tools"]')
    .include('[data-testid="tv-chip"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)
  expect(serious).toEqual([])
  await page.keyboard.press('Escape') // cierra la pista ⓘ
  await page.getByTestId('tv-exit').click()
  await expect.poll(async () => (await tv(page)).active).toBe(false)
  await expect(page.getByTestId('tv-on')).toHaveAttribute('aria-pressed', 'false')
  // Con ratón, el botón de la cabecera no está (la cabecera cabe en una fila; el menú y la T bastan).
  await expect(page.getByTestId('tv-button')).toBeHidden()
})

test('con prefers-reduced-motion, solo cortes: entra y sale sin vuelo', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openScene(page)
  const overview = await camera(page)
  // Registra el modo y la posición de la cámara de cada frame desde ya.
  await page.evaluate(() => {
    const w = window as Window & { __tvFrames?: { mode: string; camera: number[] }[] }
    w.__tvFrames = []
    const tick = () => {
      const s = window.__trazada!.scene
      w.__tvFrames!.push({ mode: s.cameraMode, camera: [...s.camera] })
      if (w.__tvFrames!.length < 600) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  await page.keyboard.press('t')
  await expect.poll(() => mode(page), { timeout: 5000 }).toBe('tv')
  await page.waitForTimeout(300)
  const pose = await camera(page)
  const frames = await page.evaluate(() => (window as Window & { __tvFrames?: { mode: string; camera: number[] }[] }).__tvFrames!)
  expect(frames.some((f) => f.mode === 'tv')).toBe(true)
  // Ningún frame a medio vuelo: la cámara está en la vista general o en el plano, nunca entre medias.
  for (const f of frames) expect(Math.min(dist(f.camera, overview), dist(f.camera, pose)), f.mode).toBeLessThan(1)
  await page.keyboard.press('Escape')
  expect(await mode(page)).toBe('overview')
})

test.describe('tablet', () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true })

  test('el botón de la cabecera la enciende; un toque en la escena la apaga sin mover la cámara', async ({ page }) => {
    await openScene(page)
    const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches || matchMedia('(hover: none)').matches)
    test.skip(!coarse, 'esta emulación no informa de puntero grueso ni de hover: none')
    const button = page.getByTestId('tv-button')
    await expect(button).toBeVisible()
    await expect(button).toHaveAccessibleName(/(Realización automática|Auto direction)/)
    await button.tap()
    await expect(button).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => mode(page), { timeout: 5000 }).toBe('tv')
    await settledRenders(page)
    const pose = await camera(page)
    const p = await canvasPoint(page)
    await page.touchscreen.tap(p.x, p.y)
    await expect.poll(async () => (await tv(page)).active).toBe(false)
    expect(await mode(page)).toBe('overview')
    await expect(button).toHaveAttribute('aria-pressed', 'false')
    await twoFrames(page)
    expect(dist(await camera(page), pose)).toBeLessThan(1)
  })
})
