/**
 * Ambiente (ítem 10, D37) sobre el fixture de Spa 2026 (FP1, 12:27 UTC en julio: sol alto). Activo por defecto: cielo
 * de día (1 draw call, ~1k triángulos) y niebla solo en la pista, dentro del presupuesto de la escena; la herramienta
 * dice la fase y la altura del sol y que es decorativo. Apagado, el fondo neutro de siempre (`--tz-scene-bg`), sin
 * niebla ni draw call, y se recuerda. En pausa no provoca renders. De noche (t0 cambiado), «Noche» y el tono de focos.
 * Con una sede desconocida, escena neutra y «sin dato de ubicación»: nunca un cielo inventado.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { gotoApp } from './helpers'

const FP1 = '/replay?s=2026/10-spa-francorchamps/fp1'
const MANIFEST = '**/sessions/2026/10-spa-francorchamps/fp1/manifest.json'
const T_MS = 85_828
/** Lo único de la escena que puede usar la niebla: la pista (TzTrack.vue). */
const TRACK_OBJECTS = ['pit-edge', 'pit-ribbon', 'track-edge', 'track-finish', 'track-ribbon']

interface AmbienceStats {
  status: 'ok' | 'no-location' | 'no-time'
  enabled: boolean
  shown: boolean
  phase: 'day' | 'dusk' | 'night' | null
  sunDeg: number | null
  trackTint: number
  fog: null | { near: number; far: number; max: number }
  drawCalls: number
  triangles: number
  fogged: boolean
  foggedObjects: string[]
}

const twoFrames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
const ambience = (page: Page) => page.evaluate(() => window.__trazada!.scene.ambience as AmbienceStats)
const scene = (page: Page) => page.evaluate(() => ({ ...window.__trazada!.scene }))

async function openScene(page: Page) {
  await gotoApp(page, FP1)
  await expect.poll(async () => (await page.evaluate(() => window.__trazada?.scene.ready)) ?? false, { timeout: 15_000 }).toBe(true)
  await page.evaluate((t) => window.__trazada!.seek(window.__trazada!.startMs + t), T_MS)
  await twoFrames(page)
}

/** La herramienta va en el menú «Capas» de las herramientas de escena: lo abre si está cerrado. */
async function openLayers(page: Page) {
  const button = page.getByTestId('tools-layers')
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click()
  await expect(page.getByTestId('ambience-tool')).toBeVisible()
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

/** Solo el lienzo: todo lo demás (paneles, siglas, avisos) oculto para la captura. */
const ONLY_CANVAS = 'body * { visibility: hidden !important; } [data-testid="scene"] canvas { visibility: visible !important; }'

/** Colores (0–255) del lienzo en puntos de la página, sobre una captura con la interfaz superpuesta oculta. */
async function canvasPixels(page: Page, points: { x: number; y: number }[]): Promise<number[][]> {
  await page.mouse.move(0, 0)
  const style = await page.addStyleTag({ content: ONLY_CANVAS })
  await twoFrames(page)
  const png = (await page.screenshot()).toString('base64')
  await style.evaluate((el) => (el as Element).remove())
  return page.evaluate(
    async ({ png, points }) => {
      const img = new Image()
      img.src = `data:image/png;base64,${png}`
      await img.decode()
      const k = img.width / window.innerWidth
      const cv = document.createElement('canvas')
      cv.width = img.width
      cv.height = img.height
      const g = cv.getContext('2d')!
      g.drawImage(img, 0, 0)
      return points.map(({ x, y }) => Array.from(g.getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data.slice(0, 3)))
    },
    { png, points },
  )
}

/** Esquinas del lienzo (lejos del circuito, que va encuadrado en el hueco libre): ahí solo hay fondo. */
async function corners(page: Page): Promise<{ x: number; y: number }[]> {
  const c = await page.locator('[data-testid="scene"] canvas').boundingBox()
  expect(c).not.toBeNull()
  return [
    { x: c!.x + 6, y: c!.y + 6 },
    { x: c!.x + c!.width - 6, y: c!.y + 6 },
    { x: c!.x + 6, y: c!.y + c!.height - 6 },
  ]
}

const sceneBg = (page: Page) =>
  page.evaluate(() => {
    const hex = getComputedStyle(document.documentElement).getPropertyValue('--tz-scene-bg').trim()
    return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  })
const diff = (a: number[], b: number[]) => a.reduce((n, v, i) => n + Math.abs(v - b[i]!), 0)

// Cada test tiene un contexto nuevo (almacenamiento vacío): sin `resetStorage`, que vaciaría también al recargar y
// el test de «se recuerda al recargar» no podría comprobar nada.

test('Spa de día: cielo y niebla solo en la pista, una draw call más dentro del presupuesto; la herramienta lo explica', async ({
  page,
}) => {
  await openScene(page)
  const a = await ambience(page)
  expect(a).toMatchObject({ status: 'ok', enabled: true, shown: true, phase: 'day', drawCalls: 1, fogged: false })
  expect(a.sunDeg!).toBeGreaterThan(40)
  expect(a.trackTint).toBe(0)
  expect(a.triangles).toBeGreaterThan(500)
  expect(a.triangles).toBeLessThan(2000)
  // Niebla de la parte cercana a la lejana de la pista, con el tope del 25 % en la más lejana.
  expect(a.fog).not.toBeNull()
  expect(a.fog!.far).toBeGreaterThan(a.fog!.near)
  expect(a.fog!.max).toBeCloseTo(0.25, 6)
  // Solo la pista usa la niebla: ni coches, ni banderas, ni estelas, ni capas, ni el cielo.
  expect(a.foggedObjects).toContain('track-ribbon')
  for (const name of a.foggedObjects) expect(TRACK_OBJECTS, name).toContain(name)

  const s = await scene(page)
  expect(s.layers.find((l) => l.name === 'ambience')).toMatchObject({ drawCalls: 1, fogged: false })
  for (const l of s.layers) expect(l.fogged, l.name).toBe(false)
  expect(s.drawCalls).toBeLessThanOrEqual(13 + s.layers.reduce((n, l) => n + l.drawCalls, 0))
  expect(s.drawCalls).toBeLessThan(30)
  expect(s.triangles).toBeLessThan(150_000)

  // El fondo ya no es el liso: el cielo de día (azulado) en las esquinas del lienzo.
  const bg = await sceneBg(page)
  for (const px of await canvasPixels(page, await corners(page))) {
    expect(diff(px, bg), String(px)).toBeGreaterThan(6)
    expect(px[2]!, String(px)).toBeGreaterThan(px[0]!)
  }

  await openLayers(page)
  const tool = page.getByTestId('ambience-tool')
  await expect(tool).toHaveAttribute('data-status', 'ok')
  await expect(tool).toHaveAttribute('data-phase', 'day')
  await expect(page.getByTestId('ambience-on')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('ambience-sun')).toHaveText(/^(Día · sol a|Day · sun at) \d{2}°$/)
  await expect(page.getByTestId('ambience-decorative')).toHaveText(
    /^(Decorativo: posición del sol, no el tiempo|Decorative: sun position, not the weather)$/,
  )
  await page.getByTestId('ambience-hint').click()
  await expect(page.getByTestId('ambience-hint-panel')).toBeVisible()
  await expect(page.getByTestId('ambience-hint-panel')).toContainText(/NOAA/)
  await expect(page.getByTestId('ambience-hint-panel')).toContainText(/UTC/)
  const results = await new AxeBuilder({ page })
    .include('[data-testid="scene-tools"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([])
})

test('apagado: fondo neutro de siempre, sin niebla ni draw call; se recuerda al recargar', async ({ page }) => {
  await openScene(page)
  const base = await scene(page)
  await openLayers(page)
  await page.getByTestId('ambience-off').click()
  await expect(page.getByTestId('ambience-off')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('ambience-sun')).toHaveCount(0)
  await expect.poll(async () => (await ambience(page)).shown).toBe(false)
  await twoFrames(page)
  expect(await ambience(page)).toMatchObject({ enabled: false, drawCalls: 0, triangles: 0, fog: null, foggedObjects: [], phase: null })
  const off = await scene(page)
  expect(off.drawCalls).toBe(base.drawCalls - 1)
  expect(off.layers.find((l) => l.name === 'ambience')).toMatchObject({ drawCalls: 0, triangles: 0 })

  // El color de borrado: exactamente `--tz-scene-bg` (±2 por canal).
  const bg = await sceneBg(page)
  for (const px of await canvasPixels(page, await corners(page))) {
    for (let i = 0; i < 3; i++) expect(Math.abs(px[i]! - bg[i]!), String(px)).toBeLessThanOrEqual(2)
  }

  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('trazada.ambience') ?? 'null'))).toEqual({ on: false, _v: 1 })
  await page.reload()
  await expect.poll(async () => (await page.evaluate(() => window.__trazada?.scene.ready)) ?? false, { timeout: 15_000 }).toBe(true)
  await twoFrames(page)
  expect(await ambience(page)).toMatchObject({ enabled: false, shown: false, drawCalls: 0 })
  await openLayers(page)
  await expect(page.getByTestId('ambience-off')).toHaveAttribute('aria-pressed', 'true')

  await page.getByTestId('ambience-on').click()
  await expect.poll(async () => (await ambience(page)).shown).toBe(true)
  await expect(page.getByTestId('ambience-sun')).toBeVisible()
})

test('con el ambiente activo, en pausa no hay renders en bucle', async ({ page }) => {
  await openScene(page)
  expect((await ambience(page)).shown).toBe(true)
  const before = await settledRenders(page)
  await page.waitForTimeout(800)
  expect(await page.evaluate(() => window.__trazada!.renders)).toBe(before)
})

test('de noche (t0 a las 22:00 UTC en julio): «Noche», cielo nocturno y la pista con el tono de focos', async ({ page }) => {
  // El manifest no va firmado (los ficheros sí): se adelanta su t0 como el de una sesión nocturna.
  await page.route(MANIFEST, async (route) => {
    const res = await route.fetch()
    const manifest = await res.json()
    manifest.session.t0Utc = '2026-07-17T22:00:00.000Z'
    await route.fulfill({ response: res, json: manifest })
  })
  await openScene(page)
  const a = await ambience(page)
  expect(a).toMatchObject({ status: 'ok', shown: true, phase: 'night', drawCalls: 1 })
  expect(a.sunDeg!).toBeLessThan(-6)
  expect(a.trackTint).toBeCloseTo(0.08, 6)
  for (const name of a.foggedObjects) expect(TRACK_OBJECTS, name).toContain(name)
  await openLayers(page)
  await expect(page.getByTestId('ambience-tool')).toHaveAttribute('data-phase', 'night')
  await expect(page.getByTestId('ambience-sun')).toHaveText(/^(Noche · sol a|Night · sun at) -\d+°$/)
})

test('sede desconocida: escena neutra y «sin dato de ubicación», nunca un cielo inventado', async ({ page }) => {
  await page.route(MANIFEST, async (route) => {
    const res = await route.fetch()
    const manifest = await res.json()
    manifest.session.slug = 'atlantis'
    await route.fulfill({ response: res, json: manifest })
  })
  await openScene(page)
  expect(await ambience(page)).toMatchObject({
    status: 'no-location',
    shown: false,
    phase: null,
    sunDeg: null,
    drawCalls: 0,
    fog: null,
    foggedObjects: [],
  })
  const bg = await sceneBg(page)
  for (const px of await canvasPixels(page, await corners(page))) {
    for (let i = 0; i < 3; i++) expect(Math.abs(px[i]! - bg[i]!), String(px)).toBeLessThanOrEqual(2)
  }
  await openLayers(page)
  await expect(page.getByTestId('ambience-tool')).toHaveAttribute('data-status', 'no-location')
  await expect(page.getByTestId('ambience-note')).toHaveText(/^(Sin dato de ubicación|No location data): /)
  await expect(page.getByTestId('ambience-on')).toHaveCount(0)
  await expect(page.getByTestId('ambience-sun')).toHaveCount(0)
})
