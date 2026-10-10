import { expect, type Page, test } from '@playwright/test'
import { gotoApp } from './helpers'

const FP1 = '/replay?s=2026/10-spa-francorchamps/fp1'
const scene = (page: Page) =>
  page.evaluate(() => ({ ...window.__trazada!.scene })) as Promise<NonNullable<Window['__trazada']>['scene']>

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

  test('la pista tiene un mínimo de anchura en pantalla de lejos y su anchura real de cerca', async ({ page }) => {
    await openScene(page)
    await page.evaluate(() => window.__trazada!.seek(window.__trazada!.startMs + 85_828))
    await expect.poll(async () => (await scene(page)).trackHalfWidthM).toBeGreaterThan(7.5)
    await page.locator('[data-testid="leaderboard"] [data-car]').first().getByRole('button').click()
    await page.getByTestId('follow-toggle').click()
    await expect.poll(async () => (await scene(page)).cameraMode, { timeout: 5000 }).toBe('follow')
    await expect.poll(async () => (await scene(page)).trackHalfWidthM, { timeout: 5000 }).toBe(7)
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
