/**
 * Hoja de análisis (ítem 3, D33) sobre el fixture (Spa 2026, libres 1): el botón de la cabecera la abre; mientras la
 * hoja tapa el escenario la escena no se redibuja (`setSceneHidden`), aunque el reloj avance; Esc la cierra y la
 * escena vuelve. En libres abre «Ritmo» (por instante de la sesión) y el race trace explica que solo hay en carrera.
 * Un clic en el ritmo y un stint pulsado saltan en el tiempo. «Sin spoilers» viene activo y oculta lo que aún no ha
 * pasado. Cabe entre la cabecera y el dock (también en iPad), la cabecera sigue en una fila a 1280 px y es accesible
 * (axe) en español y en inglés. El race trace con datos de carrera reales solo se prueba en local (Japón, @local).
 */
import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { gotoApp, resetStorage } from './helpers'

const FP1 = '/replay?s=2026/10-spa-francorchamps/fp1'

interface AnalysisStat {
  open: boolean
  tab: string
  noSpoilers: boolean
  cutoffMs: number | null
}

async function openReplay(page: Page, baseURL?: string, lang: 'es' | 'en' = 'es') {
  await page.context().addCookies([{ name: 'trazada_lang', value: lang, url: baseURL ?? 'http://127.0.0.1' }])
  await resetStorage(page)
  await gotoApp(page, FP1)
  await expect.poll(async () => (await page.evaluate(() => window.__trazada?.scene.ready)) ?? false, { timeout: 15_000 }).toBe(true)
}

const twoFrames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))

async function seek(page: Page, ms: number) {
  await page.evaluate((t) => window.__trazada!.seek(t), ms)
  await twoFrames(page)
}

const sheet = (page: Page) => page.getByTestId('analysis-sheet')
const stat = (page: Page) => page.evaluate(() => window.__trazada!.scene.analysis as AnalysisStat)

async function openSheet(page: Page) {
  await page.getByTestId('analysis-button').click()
  await expect(sheet(page)).toBeVisible()
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

async function serious(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .exclude('[data-testid="scene"] canvas')
    .analyze()
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)
}

test('abierta tapa la escena: el reloj sigue y no hay renders; Esc la cierra y la escena vuelve', async ({ page }) => {
  await openReplay(page)
  await expect(page.getByTestId('analysis-button')).toHaveAttribute('aria-expanded', 'false')
  await openSheet(page)
  await expect(page.getByTestId('analysis-button')).toHaveAttribute('aria-expanded', 'true')
  expect(await page.evaluate(() => window.__trazada!.sceneHidden)).toBe(true)
  expect((await stat(page)).open).toBe(true)

  // Reproduciendo con la hoja abierta: el reloj avanza, la escena no se redibuja.
  await page.getByTestId('rate-4').click()
  await page.getByTestId('play-toggle').click()
  const t0 = await page.evaluate(() => window.__trazada!.timeMs)
  const before = await settledRenders(page)
  await page.waitForTimeout(1_000)
  expect(await page.evaluate(() => window.__trazada!.renders)).toBe(before)
  expect(await page.evaluate(() => window.__trazada!.timeMs)).toBeGreaterThan(t0)

  // Esc la cierra (el foco está en el dock: el atajo global de Esc la atiende primero) y la escena vuelve.
  await page.keyboard.press('Escape')
  await expect(sheet(page)).toHaveCount(0)
  expect(await page.evaluate(() => window.__trazada!.sceneHidden)).toBe(false)
  await expect.poll(() => page.evaluate(() => window.__trazada!.renders)).toBeGreaterThan(before)
  await page.getByTestId('play-toggle').click()
})

test('libres: abre «Ritmo» por instante; el race trace explica que solo hay en carrera; un clic en el ritmo salta en el tiempo', async ({
  page,
}) => {
  await openReplay(page)
  const { endMs } = await page.evaluate(() => ({ endMs: window.__trazada!.endMs }))
  await seek(page, endMs)
  await openSheet(page)
  await expect(sheet(page)).toHaveAttribute('data-tab', 'pace')
  await expect(page.getByTestId('analysis-tab-pace')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('analysis-tab-pace')).toBeFocused()
  await expect(page.getByTestId('pace')).toHaveAttribute('data-axis', 'time')
  const chart = page.getByTestId('pace-chart')
  await expect(chart.locator('canvas')).toHaveCount(1)
  expect(Number(await chart.getAttribute('data-points'))).toBeGreaterThan(0)
  // Las series se identifican por la sigla en la leyenda (nunca solo por el color).
  const keys = chart.getByTestId('analysis-legend-item')
  for (const text of await keys.allTextContents()) expect(text.trim()).toMatch(/^[A-Z]{3}$/)
  await expect(chart.locator('[data-testid="analysis-legend-item"][aria-pressed="true"]')).not.toHaveCount(0)
  await expect(page.getByTestId('pace-marks')).toContainText('anulada')

  // Un clic en la gráfica salta al inicio de la vuelta más cercana (antes del final de los datos).
  await chart.locator('.u-over').click()
  await expect.poll(() => page.evaluate(() => window.__trazada!.timeMs)).toBeLessThan(endMs)

  await page.getByTestId('analysis-tab-raceTrace').click()
  await expect(sheet(page)).toHaveAttribute('data-tab', 'raceTrace')
  await expect(page.getByTestId('race-trace-only-race')).toContainText('carrera y sprint')
  await expect(page.getByTestId('race-trace-chart')).toHaveCount(0)
})

test('neumáticos: una fila por piloto, cada stint con su texto; «Sin spoilers» oculta lo que no ha pasado; pulsar uno salta', async ({
  page,
}) => {
  await openReplay(page)
  const { startMs, endMs } = await page.evaluate(() => ({ startMs: window.__trazada!.startMs, endMs: window.__trazada!.endMs }))
  await openSheet(page)
  await page.getByTestId('analysis-tab-stints').click()
  await expect(sheet(page)).toHaveAttribute('data-tab', 'stints')
  expect(await page.getByTestId('stint-row').count()).toBeGreaterThan(10)
  const bars = page.getByTestId('stint-bar')
  for (const label of await bars.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''))) {
    expect(label).toMatch(/^[A-Z]{3}: /)
    expect(label).toMatch(/(juego con \d+–\d+ vueltas|edad del juego: sin dato)/)
    expect(label).toMatch(/(nuevo|usado|sin dato)/)
  }
  await expect(page.getByTestId('stints-tyre-life-hint')).toBeVisible()

  // «Sin spoilers» activo por defecto: al principio de la reproducción hay menos stints que en la sesión entera.
  const spoilers = page.getByTestId('analysis-spoilers')
  await expect(spoilers).toHaveAttribute('aria-checked', 'true')
  expect((await stat(page)).noSpoilers).toBe(true)
  const upToNow = await bars.count()
  await spoilers.click()
  await expect(spoilers).toHaveAttribute('aria-checked', 'false')
  await expect.poll(() => bars.count()).toBeGreaterThan(upToNow)
  await spoilers.click()
  await expect.poll(() => bars.count()).toBe(upToNow)

  // Pulsar el último stint que sale dentro de la reproducción salta a su salida.
  await seek(page, endMs)
  const starts = await bars.evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-start-ms'))))
  const target = Math.max(...starts.filter((s) => s > startMs && s < endMs))
  expect(Number.isFinite(target)).toBe(true)
  await page.locator(`[data-testid="stint-bar"][data-start-ms="${target}"]`).first().click()
  await expect.poll(() => page.evaluate(() => window.__trazada!.timeMs)).toBe(target)
  // Sigue abierta y la escena, tapada.
  await expect(sheet(page)).toBeVisible()
  expect(await page.evaluate(() => window.__trazada!.sceneHidden)).toBe(true)
})

for (const lang of ['es', 'en'] as const) {
  test(`accesible (axe) con la hoja abierta, en cada pestaña (${lang})`, async ({ page, baseURL }) => {
    await openReplay(page, baseURL, lang)
    await openSheet(page)
    await expect(sheet(page)).toHaveAttribute('role', 'dialog')
    await expect(page.locator('[role="tablist"]')).toBeVisible()
    for (const tab of ['raceTrace', 'pace', 'stints']) {
      await page.getByTestId(`analysis-tab-${tab}`).click()
      await expect(sheet(page)).toHaveAttribute('data-tab', tab)
      expect(await serious(page), tab).toEqual([])
    }
  })
}

test.describe('iPad horizontal 1024×768', () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true })

  test('la hoja cabe entre la cabecera y el dock, sin scroll horizontal; pestañas con zona táctil', async ({ page }) => {
    await openReplay(page)
    await openSheet(page)
    const s = (await sheet(page).boundingBox())!
    const bar = (await page.locator('.tz-replay__bar').boundingBox())!
    const dock = (await page.getByTestId('replay-dock').boundingBox())!
    expect(s.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1)
    expect(s.y + s.height).toBeLessThanOrEqual(dock.y + 1)
    expect(s.height).toBeGreaterThan(200)
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement
      const el = document.querySelector('[data-testid="analysis-sheet"]')!
      return { page: doc.scrollWidth > doc.clientWidth, sheet: el.scrollWidth > el.clientWidth }
    })
    expect(overflow).toEqual({ page: false, sheet: false })
    // Pestañas de --tz-hit-min de alto: 44 px con puntero grueso (si la emulación lo informa), 32 px con ratón.
    const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches)
    const tab = (await page.getByTestId('analysis-tab-pace').boundingBox())!
    expect(tab.height).toBeGreaterThanOrEqual(coarse ? 43.5 : 31.5)
    // El dock sigue a mano: el reproductor funciona con la hoja abierta.
    await page.getByTestId('play-toggle').tap()
    await expect.poll(() => page.evaluate(() => window.__trazada!.playing)).toBe(true)
    await page.getByTestId('play-toggle').tap()
  })
})

for (const vp of [
  { name: 'escritorio 1440×900', width: 1440, height: 900 },
  { name: 'portátil 1280×800', width: 1280, height: 800 },
]) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } })

    test('el botón cabe en la cabecera sin partirla en dos filas (icono con su nombre accesible)', async ({ page }) => {
      await openReplay(page)
      const button = page.getByTestId('analysis-button')
      await expect(button).toHaveAccessibleName('Análisis')
      const middle = (box: { y: number; height: number }) => box.y + box.height / 2
      const title = middle((await page.getByTestId('replay-title').boundingBox())!)
      expect(Math.abs(middle((await button.boundingBox())!) - title)).toBeLessThan(12)
      // Las herramientas de la escena (lo último de la cabecera) siguen en la misma fila.
      expect(Math.abs(middle((await page.getByTestId('scene-tools').boundingBox())!) - title)).toBeLessThan(12)
    })
  })
}
