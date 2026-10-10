import { expect, type Page, test } from '@playwright/test'
import { gotoApp } from './helpers'

const FP1 = '/replay?s=2026/10-spa-francorchamps/fp1'
const scene = (page: Page) =>
  page.evaluate(() => ({ ...window.__trazada!.scene })) as Promise<NonNullable<Window['__trazada']>['scene']>

type TrackScreenSample = ReturnType<NonNullable<Window['__trazada']>['trackScreen']>[number]

const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]!

/** Puntos del eje de la pista dentro del lienzo, lejos del pit lane y de los coches (que taparían la medida). */
async function freeSamples(page: Page, stepM: number): Promise<TrackScreenSample[]> {
  return page.evaluate((stepM) => {
    const t = window.__trazada!
    const c = document.querySelector('[data-testid="scene"] canvas')!.getBoundingClientRect()
    const cars = t.cars().filter((car) => car.visible)
    return t
      .trackScreen(stepM)
      .filter((p) => !p.nearPit && p.x > c.left + 40 && p.x < c.right - 40 && p.y > c.top + 40 && p.y < c.bottom - 40)
      .filter((p) => cars.every((car) => Math.hypot(car.x - p.wx, car.y - p.wy) > 45))
  }, stepM)
}

/**
 * Anchura de la cinta en pantalla (px) en cada punto: distancia entre sus dos bordes (las líneas claras que la
 * delimitan), buscados desde el eje a lo largo de su normal en pantalla hasta dar con el fondo. Sobre una
 * captura con la interfaz superpuesta oculta.
 */
async function trackThickness(page: Page, samples: TrackScreenSample[]): Promise<number[]> {
  return (await measureTrack(page, samples)).map((m) => m.width)
}

/** Anchura (ver arriba) y color en el eje de cada punto. */
async function measureTrack(page: Page, samples: TrackScreenSample[]): Promise<{ width: number; rgb: number[] }[]> {
  await page.mouse.move(0, 0)
  await page.addStyleTag({ content: `${HIDE_UI} { visibility: hidden !important; }` })
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  const png = (await page.screenshot()).toString('base64')
  return page.evaluate(
    async ({ png, samples }) => {
      const img = new Image()
      img.src = `data:image/png;base64,${png}`
      await img.decode()
      const k = img.width / window.innerWidth
      const cv = document.createElement('canvas')
      cv.width = img.width
      cv.height = img.height
      const g = cv.getContext('2d')!
      g.drawImage(img, 0, 0)
      const data = g.getImageData(0, 0, cv.width, cv.height).data
      g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--tz-scene-bg').trim()
      const bg = [1, 3, 5].map((i) => parseInt(String(g.fillStyle).slice(i, i + 2), 16))
      /** Suma de canales del píxel y si es fondo. */
      const pixel = (x: number, y: number): [number, boolean] => {
        const px = Math.round(x * k)
        const py = Math.round(y * k)
        if (px < 0 || py < 0 || px >= cv.width || py >= cv.height) return [0, true]
        const i = (py * cv.width + px) * 4
        const d = Math.abs(data[i]! - bg[0]!) + Math.abs(data[i + 1]! - bg[1]!) + Math.abs(data[i + 2]! - bg[2]!)
        return [data[i]! + data[i + 1]! + data[i + 2]!, d < 30]
      }
      return samples.map((s) => {
        const limit = Math.max(80, s.realPx)
        // El borde es el píxel más claro antes del fondo (las líneas de borde son más claras que la cinta); se
        // toma el centro de ese píxel (el tramo de pasos que caen en él), no su primer paso.
        const edge = (dir: number) => {
          let best = -1
          let first = 0
          let last = 0
          for (let t = 0; t < limit; t += 0.25) {
            const [lum, isBg] = pixel(s.x + dir * s.nx * t, s.y + dir * s.ny * t)
            if (isBg) break
            if (lum > best) [best, first, last] = [lum, t, t]
            else if (lum === best && t - last <= 0.25) last = t
          }
          return (first + last) / 2
        }
        const px = Math.round(s.x * k)
        const py = Math.round(s.y * k)
        const i = (py * cv.width + px) * 4
        return { width: edge(1) + edge(-1), rgb: [data[i]!, data[i + 1]!, data[i + 2]!] }
      })
    },
    { png, samples },
  )
}

const HIDE_UI =
  '.tz-replay__bar, .tz-replay__side, [data-testid="replay-dock"], [data-testid="scene-tools"], [data-testid="leaderboard"], .tz-labels, .tz-cars'

async function openScene(page: Page) {
  await gotoApp(page, FP1)
  await expect.poll(async () => (await page.evaluate(() => window.__trazada?.scene.ready)) ?? false, { timeout: 15_000 }).toBe(true)
}

test('circuito: pit lane a ±10 % de las muestras y exageración marcada como Estimado', async ({ page }) => {
  await openScene(page)
  const s = await scene(page)
  expect(s.pitLaneLengthM).toBeGreaterThan(0)
  expect(Math.abs(s.pitLaneLengthM - s.pitSamplesLengthM) / s.pitSamplesLengthM).toBeLessThanOrEqual(0.1)

  await expect(page.getByTestId('elevation-1')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('estimated')).toHaveCount(0)
  const renders = await page.evaluate(() => window.__trazada!.renders)
  await page.getByTestId('elevation-3').click()
  await expect(page.getByTestId('estimated')).toBeVisible()
  await expect(page.getByTestId('estimated')).toContainText('×3')
  await expect.poll(() => page.evaluate(() => window.__trazada!.renders)).toBeGreaterThan(renders)
  expect((await scene(page)).elevationScale).toBe(3)

  // La preferencia se recuerda al recargar.
  await openScene(page)
  await expect(page.getByTestId('elevation-3')).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('elevation-1').click()
  await expect(page.getByTestId('estimated')).toHaveCount(0)
})

test('captura del circuito de Spa con cámara fija @screenshot', async ({ page }) => {
  // Las referencias se generan en el contenedor de CI (workflow "Snapshots"); otro Chromium da píxeles distintos.
  test.skip(!process.env.CI, 'las capturas de referencia solo se comparan en CI')
  test.skip(process.env.SKIP_SCREENSHOTS === 'true', 'el workflow Snapshots está regenerando las referencias')
  await page.addInitScript(() => localStorage.clear())
  await openScene(page)
  await page.mouse.move(0, 0)
  // Solo el lienzo: se oculta la interfaz superpuesta (y el chip con el tiempo de carga, que varía).
  await page.addStyleTag({
    content:
      '.tz-replay__bar, .tz-replay__side, [data-testid="replay-dock"], [data-testid="scene-tools"], [data-testid="leaderboard"], .tz-labels, .tz-cars { visibility: hidden !important; }',
  })
  await expect(page.locator('[data-testid="scene"] canvas')).toHaveScreenshot('spa.png', { maxDiffPixelRatio: 0.01 })
})

test.describe('legibilidad del mapa', () => {
  for (const vp of [
    { name: 'escritorio 1440×900', width: 1440, height: 900 },
    { name: 'iPad vertical 768×1024', width: 768, height: 1024 },
  ]) {
    test(`${vp.name}: el circuito llena el hueco libre entre paneles, sin meterse debajo`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await openScene(page)
      // Tras llenarse la clasificación (puede reencuadrar una vez).
      await page.waitForTimeout(600)
      const f = (await scene(page)).framing!
      expect(f).not.toBeNull()
      expect(f.box.x0).toBeGreaterThanOrEqual(f.free.x0 - 1e-3)
      expect(f.box.x1).toBeLessThanOrEqual(f.free.x1 + 1e-3)
      expect(f.box.y0).toBeGreaterThanOrEqual(f.free.y0 - 1e-3)
      expect(f.box.y1).toBeLessThanOrEqual(f.free.y1 + 1e-3)
      const fill = Math.max((f.box.x1 - f.box.x0) / (f.free.x1 - f.free.x0), (f.box.y1 - f.box.y0) / (f.free.y1 - f.free.y0))
      expect(fill).toBeGreaterThan(0.85)
      // El hueco libre es de verdad libre: no lo pisan la clasificación, los paneles ni los controles.
      const overlaps = await page.evaluate((free) => {
        const c = document.querySelector('[data-testid="scene"] canvas')!.getBoundingClientRect()
        const px = { left: c.left + ((free.x0 + 1) / 2) * c.width, right: c.left + ((free.x1 + 1) / 2) * c.width, top: c.top + ((1 - free.y1) / 2) * c.height, bottom: c.top + ((1 - free.y0) / 2) * c.height }
        const out: string[] = []
        for (const sel of ['[data-testid="leaderboard"]', '[data-testid="race-control"]', '[data-testid="replay-dock"]']) {
          const r = document.querySelector(sel)!.getBoundingClientRect()
          const inter = Math.min(r.right, px.right) - Math.max(r.left, px.left) > 1 && Math.min(r.bottom, px.bottom) - Math.max(r.top, px.top) > 1
          if (inter) out.push(sel)
        }
        return out
      }, f.free)
      expect(overlaps).toEqual([])
    })
  }

  for (const vp of [
    { name: 'escritorio 1440×900', width: 1440, height: 900 },
    { name: 'iPad vertical 768×1024', width: 768, height: 1024 },
  ]) {
    test(`${vp.name}: la pista se ve con al menos 7 px también en la parte lejana del circuito`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await openScene(page)
      await page.evaluate(() => window.__trazada!.seek(window.__trazada!.startMs + 85_828))
      await page.waitForTimeout(600)
      const samples = await freeSamples(page, 20)
      // La parte de arriba de la pantalla es la más lejana (la cámara mira al norte, inclinada).
      const ys = samples.map((p) => p.y).sort((a, b) => a - b)
      const far = samples.filter((p) => p.y <= ys[Math.floor(ys.length * 0.3)]!)
      expect(far.length).toBeGreaterThan(10)
      for (const p of samples) expect(p.expectedPx).toBeGreaterThanOrEqual(7 - 1e-6)
      const widths = await trackThickness(page, far)
      const msg = widths.join(' ')
      // Lo que se dibuja es lo que dice la cuenta (shader ≙ mapHalfWidth), también lejos y en escorzo.
      // (La medida es al píxel: ±0,5 px por borde.)
      expect(median(widths.map((w, i) => Math.abs(w - far[i]!.expectedPx))), msg).toBeLessThan(0.75)
      expect(widths.filter((w) => w >= 6).length / widths.length, msg).toBeGreaterThan(0.85)
    })
  }

  test('donde el pit lane se junta con la pista, manda la pista (el pit no la tapa)', async ({ page }) => {
    await openScene(page)
    const samples = (await page.evaluate(() => window.__trazada!.trackScreen(2))).filter((p) => p.nearPit)
    expect(samples.length).toBeGreaterThan(20)
    // Color del eje de la pista en cada punto: la pista es gris azulada (verde ≥ rojo); el pit, violeta.
    const purple = (await measureTrack(page, samples)).filter(({ rgb }) => rgb[0]! > rgb[1]! + 4).length
    expect(purple).toBe(0)
  })

  test('siguiendo a un coche, la pista se ve con su anchura real (no se ensancha de cerca)', async ({ page }) => {
    await openScene(page)
    await page.evaluate(() => window.__trazada!.seek(window.__trazada!.startMs + 85_828))
    await page.locator('[data-testid="leaderboard"] [data-car]').first().getByRole('button').click()
    await page.getByTestId('follow-toggle').click()
    await expect.poll(async () => (await scene(page)).cameraMode, { timeout: 5000 }).toBe('follow')
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    const near = (await freeSamples(page, 5)).filter((p) => p.realPx > 20 && p.realPx < 150)
    expect(near.length).toBeGreaterThan(3)
    for (const p of near) expect(p.expectedPx).toBeCloseTo(p.realPx, 3)
    const ratios = (await trackThickness(page, near)).map((w, i) => w / near[i]!.realPx)
    expect(median(ratios), ratios.join(' ')).toBeGreaterThan(0.9)
    expect(median(ratios), ratios.join(' ')).toBeLessThan(1.1)
  })

  test('las siglas de los coches no se pisan (con los coches juntos se ve la del que va delante)', async ({ page }) => {
    await openScene(page)
    await page.evaluate(() => window.__trazada!.seek(window.__trazada!.startMs + 85_828))
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    const rects = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('[data-testid="car-labels"] [data-car]')]
        .filter((el) => getComputedStyle(el).visibility === 'visible')
        .map((el) => el.getBoundingClientRect())
        .map((r) => ({ l: r.left, r: r.right, t: r.top, b: r.bottom })),
    )
    expect(rects.length).toBeGreaterThan(3)
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]!
        const b = rects[j]!
        const overlap = Math.min(a.r, b.r) - Math.max(a.l, b.l) > 0.5 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 0.5
        expect(overlap, `${i}-${j}`).toBe(false)
      }
    }
  })
})
