/** TEMPORAL (verificación visual de las siglas de las gráficas de análisis). Se borra al acabar. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { expect, type Browser, type Page, test } from '@playwright/test'
import { markTipsSeen } from './helpers'

const OUT = '/tmp/claude-0/-home-user-trazada/bc5b8152-ecca-5c5e-80ab-2d9156c82ce3/scratchpad/verify-labels'
const JP = 'http://127.0.0.1:4199'
const SPA = 'http://127.0.0.1:4198'
mkdirSync(OUT, { recursive: true })

test.describe.configure({ mode: 'parallel' })
test.setTimeout(180_000)

/** Registra las siglas (3 letras) que se dibujan en cada lienzo, con su posición y ancho, y los arcos y guías. */
const HOOK = () => {
  type Rec = { t: string; x: number; y: number; w: number; cw: number; ch: number }
  const per = new WeakMap<HTMLCanvasElement, Rec[]>()
  const all: HTMLCanvasElement[] = []
  const P = CanvasRenderingContext2D.prototype
  const fillText = P.fillText
  const clearRect = P.clearRect
  P.clearRect = function (this: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
    if (x === 0 && y === 0 && w >= this.canvas.width && h >= this.canvas.height) per.set(this.canvas as HTMLCanvasElement, [])
    return clearRect.call(this, x, y, w, h)
  } as typeof P.clearRect
  P.fillText = function (this: CanvasRenderingContext2D, text: string, x: number, y: number, mw?: number) {
    if (/^[A-Z]{3}$/.test(text)) {
      const c = this.canvas as HTMLCanvasElement
      if (!per.has(c)) {
        per.set(c, [])
      }
      if (!all.includes(c)) all.push(c)
      const m = this.measureText(text)
      const t = this.getTransform()
      per.get(c)!.push({ t: text, x: x * t.a + t.e, y: y * t.d + t.f, w: m.width * t.a, cw: c.width, ch: c.height })
    }
    return mw === undefined ? fillText.call(this, text, x, y) : fillText.call(this, text, x, y, mw)
  } as typeof P.fillText
  ;(window as unknown as { __labels: () => Rec[][] }).__labels = () => all.filter((c) => c.isConnected).map((c) => per.get(c) ?? [])
}

async function setup(page: Page, base: string) {
  await page.context().addCookies([{ name: 'trazada_lang', value: 'es', url: base }])
  await markTipsSeen(page)
  await page.addInitScript(HOOK)
}

async function openSession(page: Page, base: string, s: string) {
  await setup(page, base)
  await page.goto(`${base}/replay?s=${s}`)
  await page.waitForFunction(() => window.__trazada?.scene.ready, null, { timeout: 60_000 })
}

async function seekFrac(page: Page, f: number) {
  await page.evaluate((f) => {
    const h = window.__trazada!
    h.seek(h.startMs + (h.endMs - h.startMs) * f)
  }, f)
  await page.waitForTimeout(600)
}

async function settle(page: Page) {
  await page.mouse.move(0, 0)
  await page.waitForTimeout(400)
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
}

type Rec = { t: string; x: number; y: number; w: number; cw: number; ch: number }
async function shots(page: Page, name: string, chartId: string) {
  await settle(page)
  await page.screenshot({ path: `${OUT}/${name}-page.png` })
  const plot = page.getByTestId(chartId).locator('.tz-achart__plot')
  await plot.screenshot({ path: `${OUT}/${name}-chart.png` })
  const box = (await plot.boundingBox())!
  const w = Math.min(320, box.width)
  await page.screenshot({ path: `${OUT}/${name}-right.png`, clip: { x: box.x + box.width - w, y: box.y, width: w, height: box.height } })
  await page.getByTestId(chartId).screenshot({ path: `${OUT}/${name}-figure.png` })
  const labels = await page.evaluate(() => (window as unknown as { __labels: () => Rec[][] }).__labels())
  const legend = await page.getByTestId(chartId).getByTestId('analysis-legend-item').evaluateAll((els) =>
    els.map((e) => ({ t: e.textContent?.trim().replace(/\s+/g, ' '), pressed: e.getAttribute('aria-pressed') })),
  )
  const cursor = await page
    .getByTestId(chartId)
    .getByTestId('analysis-cursor')
    .evaluate((e) => ({ hidden: (e as HTMLElement).hidden, transform: (e as HTMLElement).style.transform }))
    .catch(() => null)
  writeFileSync(`${OUT}/${name}.json`, JSON.stringify({ plotBox: box, dpr: await page.evaluate(() => devicePixelRatio), labels, legend, cursor }, null, 1))
}

async function openSheet(page: Page) {
  await page.getByTestId('analysis-button').click()
  await expect(page.getByTestId('analysis-sheet')).toBeVisible()
}

async function spoilersOff(page: Page) {
  const sw = page.getByTestId('analysis-spoilers')
  if ((await sw.getAttribute('aria-checked')) === 'true') await sw.click()
  await expect(sw).toHaveAttribute('aria-checked', 'false')
  await page.waitForTimeout(500)
}

async function select(page: Page, car: string) {
  await page.locator(`[data-testid="leaderboard"] [data-car="${car}"]`).getByRole('button').first().click()
  await expect.poll(() => page.evaluate(() => window.__trazada!.selectedCar)).toBe(car)
}

for (const f of [0.2, 0.42, 0.7, 0.95, 1]) {
  test(`jp trace nospoil ${f}`, async ({ page }) => {
    await openSession(page, JP, '2026/03-suzuka/race')
    await seekFrac(page, f)
    await openSheet(page)
    await expect(page.getByTestId('analysis-spoilers')).toHaveAttribute('aria-checked', 'true')
    await shots(page, `jp-trace-nospoil-${Math.round(f * 100)}`, 'race-trace-chart')
  })
}

test('jp trace spoilers off', async ({ page }) => {
  await openSession(page, JP, '2026/03-suzuka/race')
  await seekFrac(page, 0.1)
  await openSheet(page)
  await spoilersOff(page)
  await shots(page, 'jp-trace-full', 'race-trace-chart')
})

for (const car of ['23', '18', 'leader']) {
  test(`jp trace selected ${car}`, async ({ page }) => {
    await openSession(page, JP, '2026/03-suzuka/race')
    await seekFrac(page, car === '18' ? 0.6 : 0.99)
    let c = car
    if (car === 'leader') c = (await page.locator('[data-testid="leaderboard"] [data-car]').first().getAttribute('data-car'))!
    await select(page, c)
    await openSheet(page)
    await shots(page, `jp-trace-sel-${car}-nospoil`, 'race-trace-chart')
    await spoilersOff(page)
    await shots(page, `jp-trace-sel-${car}-full`, 'race-trace-chart')
  })
}

test('jp pace', async ({ page }) => {
  await openSession(page, JP, '2026/03-suzuka/race')
  await seekFrac(page, 0.99)
  await openSheet(page)
  await spoilersOff(page)
  await page.getByTestId('analysis-tab-pace').click()
  await expect(page.getByTestId('pace')).toHaveAttribute('data-axis', 'lap')
  await shots(page, 'jp-pace-default', 'pace-chart')
  const items = page.getByTestId('pace-chart').getByTestId('analysis-legend-item')
  const n = await items.count()
  for (let i = 0; i < n; i++) {
    const it = items.nth(i)
    if ((await it.getAttribute('aria-pressed')) === 'false') await it.click()
  }
  await shots(page, 'jp-pace-all', 'pace-chart')
  await page.getByTestId('pace-scale').click().catch(() => {})
  await shots(page, 'jp-pace-all-scaleall', 'pace-chart')
})

test('jp pace nospoil mid', async ({ page }) => {
  await openSession(page, JP, '2026/03-suzuka/race')
  await seekFrac(page, 0.7)
  await openSheet(page)
  await page.getByTestId('analysis-tab-pace').click()
  const items = page.getByTestId('pace-chart').getByTestId('analysis-legend-item')
  const n = await items.count()
  for (let i = 0; i < n; i++) {
    const it = items.nth(i)
    if ((await it.getAttribute('aria-pressed')) === 'false') await it.click()
  }
  await shots(page, 'jp-pace-all-nospoil-70', 'pace-chart')
})

async function sized(browser: Browser, w: number, h: number, touch = false) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, locale: 'es-ES' })
  return ctx.newPage()
}

for (const [w, h] of [
  [768, 1024],
  [1280, 800],
] as const) {
  test(`jp trace ${w}x${h}`, async ({ browser }) => {
    const page = await sized(browser, w, h, w < 1000)
    await openSession(page, JP, '2026/03-suzuka/race')
    await seekFrac(page, 0.99)
    await openSheet(page)
    await shots(page, `jp-trace-${w}x${h}-nospoil99`, 'race-trace-chart')
    await spoilersOff(page)
    await shots(page, `jp-trace-${w}x${h}-full`, 'race-trace-chart')
    await page.getByTestId('analysis-tab-pace').click()
    await shots(page, `jp-pace-${w}x${h}-default`, 'pace-chart')
    await page.close()
  })
}

test('jp trace dpr2 full', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'es-ES' })
  const page = await ctx.newPage()
  await openSession(page, JP, '2026/03-suzuka/race')
  await seekFrac(page, 0.99)
  await openSheet(page)
  await spoilersOff(page)
  await shots(page, 'jp-trace-dpr2-full', 'race-trace-chart')
  await select(page, '23').catch(() => {})
  await page.close()
})

test('spa fp1 pace', async ({ page }) => {
  await openSession(page, SPA, '2026/10-spa-francorchamps/fp1')
  await seekFrac(page, 0.99)
  await openSheet(page)
  await page.getByTestId('analysis-tab-pace').click()
  await expect(page.getByTestId('pace')).toHaveAttribute('data-axis', 'time')
  await shots(page, 'spa-pace-default', 'pace-chart')
  const items = page.getByTestId('pace-chart').getByTestId('analysis-legend-item')
  const n = await items.count()
  for (let i = 0; i < n; i++) {
    const it = items.nth(i)
    if ((await it.getAttribute('aria-pressed')) === 'false') await it.click()
  }
  await shots(page, 'spa-pace-all', 'pace-chart')
  await spoilersOff(page)
  await shots(page, 'spa-pace-all-full', 'pace-chart')
})
