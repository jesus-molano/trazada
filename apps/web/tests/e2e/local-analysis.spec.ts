/**
 * Hoja de análisis (ítem 3, D33) con la carrera de Japón 2026 (datos completos de data/; fuente dev, nunca en un
 * fixture): el race trace con datos de carrera reales, «Sin spoilers» y la línea de la vuelta en curso. Con el sprint de
 * Singapur 2026 (si está en el catálogo), la revisión del usuario (D49): la leyenda por grupos y la ficha de cada línea.
 * Solo en local, con un servidor aparte:
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
    const byCanvas = new WeakMap<HTMLCanvasElement, Drawn[]>()
    ;(window as unknown as { __labels: (c: HTMLCanvasElement) => Drawn[] }).__labels = (c) => byCanvas.get(c) ?? []
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

test('siglas del race trace: en el margen derecho, dentro del lienzo y sin pisarse; los detenidos, «hasta Vn»', async ({ page }) => {
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
  const canvas = await chart.locator('canvas').elementHandle()
  const geo = await chart.evaluate((el) => {
    const c = el.querySelector('canvas')!
    const over = el.querySelector<HTMLElement>('.u-over')!
    const dpr = c.width / c.getBoundingClientRect().width
    return { w: c.width, h: c.height, right: (over.offsetLeft + over.offsetWidth) * dpr, dpr }
  })
  const labels = await page.evaluate(
    (c) => (window as unknown as { __labels: (c: HTMLCanvasElement) => { text: string; x: number; y: number; align: string; width: number }[] }).__labels(c!),
    canvas,
  )
  const names = labels.map((l) => l.text)
  // El ganador y ALB (doblado, solo abajo) llevan sigla; los detenidos, no. En el pelotón no caben todas cerca de su
  // dato: las que faltan las nombra la leyenda.
  expect(names).toContain('ANT')
  expect(names).toContain('ALB')
  expect(names).not.toContain('STR')
  expect(names).not.toContain('BEA')
  expect(new Set(names).size).toBe(names.length)
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

// --- D49 ---

test('Japón: el grupo «Dejaron de pasar por meta» es exactamente BEA y STR (los doblados cruzan tras la bandera)', async ({ page }) => {
  await open(page)
  await page.getByTestId('analysis-button').click()
  await page.getByTestId('analysis-spoilers').click()
  const stopped = page.locator('[data-testid="race-trace-chart"] [data-group="stopped"] [data-testid="analysis-legend-item"]')
  await expect.poll(async () => (await stopped.evaluateAll((els) => els.map((e) => e.getAttribute('data-car')))).sort()).toEqual(['18', '87'])
})

const SINGAPORE = '2026/18-marina-bay/sprint'

async function hasSingapore(page: Page): Promise<boolean> {
  const res = await page.request.get(`${BASE}/data/v1/catalog.json`)
  if (!res.ok()) return false
  const catalog = (await res.json()) as { seasons: { events: { round: number; slug: string; sessions: { session: string }[] }[] }[] }
  return catalog.seasons.some((s) => s.events.some((e) => e.slug === 'marina-bay' && e.sessions.some((x) => x.session === 'sprint')))
}

async function openSingapore(page: Page) {
  test.skip(!(await hasSingapore(page)), 'sin el sprint de Singapur 2026 en el catálogo')
  await page.context().addCookies([{ name: 'trazada_lang', value: 'es', url: BASE! }])
  await markTipsSeen(page)
  await page.goto(`${BASE}/replay?s=${SINGAPORE}`)
  await page.waitForFunction(() => window.__trazada?.scene.ready, null, { timeout: 30_000 })
  await page.getByTestId('analysis-button').click()
  await expect(page.getByTestId('analysis-sheet')).toHaveAttribute('data-tab', 'raceTrace')
  await page.getByTestId('analysis-spoilers').click()
  await expect(page.getByTestId('analysis-spoilers')).toHaveAttribute('aria-checked', 'false')
}

const twoFrames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))

test.describe('sprint de Singapur 2026 (D49)', () => {
  test.use({ viewport: { width: 1760, height: 990 } })

  test('leyenda por grupos: 13 de arriba abajo, 8 detenidos en el orden de la clasificación y STR sin vueltas (22 pilotos)', async ({ page }) => {
    await openSingapore(page)
    const chart = page.getByTestId('race-trace-chart')
    const group = (g: string) => chart.locator(`[data-group="${g}"]`)
    await expect(group('running').getByTestId('analysis-legend-item')).toHaveCount(13)
    await expect(group('running')).toContainText('De arriba abajo')
    const stopped = await group('stopped')
      .getByTestId('analysis-legend-item')
      .evaluateAll((els) => els.map((e) => e.textContent!.replace(/\s+/g, ' ').trim()))
    expect(stopped).toEqual(['PIA hasta V19', 'ALB hasta V14', 'BOR hasta V6', 'BOT hasta V6', 'HAD hasta V2', 'COL hasta V2', 'RUS hasta V1', 'PER hasta V1'])
    await expect(group('noLaps').getByTestId('analysis-legend-nodata')).toHaveText(['STR'])
    const drivers = await page.evaluate(async (url) => {
      const res = await fetch(url)
      return ((await res.json()) as { drivers: unknown[] }).drivers.length
    }, `${BASE}/data/v1/sessions/${SINGAPORE}/manifest.json`)
    expect(13 + stopped.length + 1).toBe(drivers)
  })

  test('al pasar por la línea de ALB en la V10: resaltada y su ficha (P15, +74,2 s, V14, pit lane, dirección de carrera)', async ({ page }) => {
    // Barre en vertical con el ratón (un paso por frame de pantalla): con la suite entera, más de 30 s.
    test.setTimeout(90_000)
    await openSingapore(page)
    const chart = page.getByTestId('race-trace-chart')
    const over = (await chart.locator('.u-over').boundingBox())!
    // El eje va de la V1 a la V20: la V10, a 9/19 del ancho.
    const x = over.x + (9 / 19) * over.width
    let found = false
    // Una línea se toca a 12 px en vertical: con pasos de 4 px no se salta ninguna.
    for (let y = over.y + 2; y < over.y + over.height && !found; y += 4) {
      await page.mouse.move(x, y)
      await twoFrames(page)
      found = (await chart.getAttribute('data-preview')) === '23'
    }
    expect(found).toBe(true)
    const card = page.getByTestId('analysis-card')
    await expect(card).toBeVisible()
    await expect(page.getByTestId('analysis-card-head')).toHaveText(/ALB\s*· Alexander Albon/)
    await expect(page.getByTestId('analysis-card-lap')).toHaveText('V10: P15 en la línea, a +74,2 s del primero')
    await expect(page.getByTestId('analysis-card-last')).toHaveText('Último paso por meta: V14.')
    await expect(page.getByTestId('analysis-card-pit')).toHaveText('Entró en el pit lane en esa vuelta.')
    await expect(page.getByTestId('analysis-card-after')).toHaveText('Después, ningún paso por meta más en los datos; la fuente no dice por qué.')
    const rc = page.getByTestId('analysis-card-rc')
    await expect(rc).toHaveCount(2)
    await expect(rc.first()).toContainText('V14')
    await expect(rc.first()).toContainText('Incidente')
    await expect(rc.first()).toContainText('23 (ALB) AND 5 (BOR)')
    await expect(page.getByTestId('analysis-card-rc-more')).toHaveText('y 1 más en dirección de carrera')
    await expect(page.getByTestId('analysis-card-click')).toHaveText('Clic: ir al inicio de la V10')
    await expect(card).not.toContainText(/retir|abandon|estrell|accident|crash/i)
  })

  test('al pasar por una sigla de la columna final, se resalta la serie de ese piloto', async ({ page }) => {
    await recordLabels(page)
    await openSingapore(page)
    const chart = page.getByTestId('race-trace-chart')
    await twoFrames(page)
    const canvas = await chart.locator('canvas').elementHandle()
    const labels = await page.evaluate(
      (c) => (window as unknown as { __labels: (c: HTMLCanvasElement) => { text: string; x: number; y: number; width: number }[] }).__labels(c!),
      canvas,
    )
    const cbox = (await chart.locator('canvas').boundingBox())!
    const dpr = await chart.locator('canvas').evaluate((c: HTMLCanvasElement) => c.width / c.getBoundingClientRect().width)
    const label = labels.find((l) => l.text === 'VER') ?? labels[0]!
    const car = await chart
      .getByTestId('analysis-legend-item')
      .filter({ hasText: new RegExp(`^\\s*${label.text}`) })
      .first()
      .getAttribute('data-car')
    await page.mouse.move(cbox.x + (label.x + label.width / 2) / dpr, cbox.y + label.y / dpr)
    await expect(chart).toHaveAttribute('data-preview', car!)
    await expect(page.getByTestId('analysis-card')).toBeVisible()
  })
})
