/**
 * Hoja de análisis (ítem 3, D33) con la carrera de Japón 2026 (datos completos de data/; fuente dev, nunca en un
 * fixture): el race trace con datos de carrera reales, «Sin spoilers» y la línea de la vuelta en curso. Solo en
 * local, con un servidor aparte:
 *   E2E_DATA_DIR=../../data node tests/e2e/serve.mjs --port 4199
 *   E2E_LOCAL_URL=http://127.0.0.1:4199 pnpm e2e local-analysis
 */
import { expect, type Page, test } from '@playwright/test'
import { markTipsSeen } from './helpers'

const BASE = process.env.E2E_LOCAL_URL
test.skip(!BASE, 'solo en local (E2E_LOCAL_URL con data/ servido)')

async function open(page: Page) {
  await markTipsSeen(page)
  await page.goto(`${BASE}/replay?s=2026/03-suzuka/race`)
  await page.waitForFunction(() => window.__trazada?.scene.ready, null, { timeout: 30_000 })
}

test('race trace hasta el reloj, con la línea de la vuelta en curso; sin «Sin spoilers», la carrera entera', async ({ page }) => {
  await open(page)
  const { startMs, endMs } = await page.evaluate(() => ({ startMs: window.__trazada!.startMs, endMs: window.__trazada!.endMs }))
  await page.evaluate((t) => window.__trazada!.seek(t), (startMs + endMs) / 2)
  await page.getByTestId('analysis-button').click()
  const sheet = page.getByTestId('analysis-sheet')
  await expect(sheet).toHaveAttribute('data-tab', 'raceTrace')
  expect(await page.evaluate(() => window.__trazada!.sceneHidden)).toBe(true)

  const chart = page.getByTestId('race-trace-chart')
  await expect(chart.locator('canvas')).toHaveCount(1)
  const upToNow = Number(await chart.getAttribute('data-points'))
  expect(upToNow).toBeGreaterThan(5)
  // La línea del instante actual, visible (la vuelta en curso del primero entra en el eje).
  await expect(chart.getByTestId('analysis-cursor')).toBeVisible()
  // Todas las series con su sigla en la leyenda.
  expect(await chart.getByTestId('analysis-legend-item').count()).toBeGreaterThanOrEqual(20)

  await page.getByTestId('analysis-spoilers').click()
  await expect.poll(async () => Number(await chart.getAttribute('data-points'))).toBeGreaterThan(upToNow)

  // Un clic en la gráfica salta al inicio de una vuelta.
  const before = await page.evaluate(() => window.__trazada!.timeMs)
  await chart.locator('.u-over').click({ position: { x: 20, y: 20 } })
  await expect.poll(() => page.evaluate(() => window.__trazada!.timeMs)).toBeLessThan(before)

  await page.getByTestId('analysis-tab-pace').click()
  await expect(page.getByTestId('pace')).toHaveAttribute('data-axis', 'lap')
  await expect(page.getByTestId('pace-lap1')).toBeVisible()

  await page.getByTestId('analysis-tab-stints').click()
  expect(await page.getByTestId('stint-row').count()).toBeGreaterThanOrEqual(20)
  await expect(page.getByTestId('stint-bar').first()).toBeVisible()
})

/** Siglas (tres letras) que se dibujan en cada lienzo, desde su último borrado (uPlot borra antes de cada redibujado). */
async function recordLabels(page: Page) {
  await page.addInitScript(() => {
    type Drawn = { text: string; x: number; y: number; align: string; width: number }
    const byCanvas = new Map<HTMLCanvasElement, Drawn[]>()
    ;(window as unknown as { __labels: () => Drawn[][] }).__labels = () => [...byCanvas.values()]
    const proto = CanvasRenderingContext2D.prototype
    const clear = proto.clearRect
    proto.clearRect = function (...args) {
      byCanvas.set(this.canvas, [])
      return clear.apply(this, args)
    }
    const fill = proto.fillText
    proto.fillText = function (text, x, y, maxWidth) {
      if (/^[A-Z]{3}$/.test(String(text))) {
        const list = byCanvas.get(this.canvas) ?? []
        list.push({ text: String(text), x, y, align: this.textAlign, width: this.measureText(String(text)).width })
        byCanvas.set(this.canvas, list)
      }
      return fill.call(this, text, x, y, maxWidth)
    }
  })
}

test('siglas del race trace: todas en el margen derecho, dentro del lienzo y sin pisarse; los detenidos, «hasta Vn»', async ({ page }) => {
  await recordLabels(page)
  await open(page)
  await page.evaluate(() => window.__trazada!.seek(window.__trazada!.endMs))
  await page.getByTestId('analysis-button').click()
  const chart = page.getByTestId('race-trace-chart')
  await expect(chart.locator('canvas')).toHaveCount(1)
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  // STR (18) deja de pasar por meta en la vuelta 30 y BEA (87) en la 20: raya y «hasta Vn», sin sigla.
  await expect(chart.locator('[data-car="18"] [data-testid="analysis-legend-until"]')).toHaveText(/hasta V30|to L30/)
  await expect(chart.locator('[data-car="87"] [data-testid="analysis-legend-until"]')).toHaveText(/hasta V20|to L20/)
  const legend = await chart.getByTestId('analysis-legend-item').count()
  const geo = await chart.evaluate((el) => {
    const canvas = el.querySelector('canvas')!
    const over = el.querySelector<HTMLElement>('.u-over')!
    const dpr = canvas.width / canvas.getBoundingClientRect().width
    return { w: canvas.width, h: canvas.height, right: (over.offsetLeft + over.offsetWidth) * dpr, dpr }
  })
  const lists = await page.evaluate(() => (window as unknown as { __labels: () => { text: string; x: number; y: number; align: string; width: number }[][] }).__labels())
  const labels = lists.find((l) => l.length > 0)!
  expect(labels.map((l) => l.text)).toContain('ALB')
  expect(labels.map((l) => l.text)).not.toContain('STR')
  expect(labels.map((l) => l.text)).not.toContain('BEA')
  expect(labels).toHaveLength(legend - 2)
  for (const l of labels) {
    expect(l.align, l.text).toBe('left')
    expect(l.x, l.text).toBeGreaterThanOrEqual(geo.right)
    expect(l.x + l.width, l.text).toBeLessThanOrEqual(geo.w)
    expect(l.y, l.text).toBeGreaterThan(0)
    expect(l.y, l.text).toBeLessThan(geo.h)
  }
  const ys = labels.map((l) => l.y).sort((a, b) => a - b)
  for (let i = 1; i < ys.length; i++) expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(10 * geo.dpr)
})
