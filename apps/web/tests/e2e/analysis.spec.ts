/**
 * Hoja de análisis (ítem 3, D33) sobre el fixture (Spa 2026, libres 1): el botón de la cabecera la abre; mientras la
 * hoja tapa el escenario la escena no se redibuja (`setSceneHidden`), aunque el reloj avance; Esc la cierra y la
 * escena vuelve. En libres abre «Ritmo» (por instante de la sesión) y el race trace explica que solo hay en carrera.
 * Un clic en el ritmo y un stint pulsado saltan en el tiempo. «Sin spoilers» viene activo y oculta lo que aún no ha
 * pasado. Cabe entre la cabecera y el dock (también en iPad), la cabecera sigue en una fila a 1280 px y es accesible
 * (axe) en español y en inglés. El race trace con datos de carrera reales solo se prueba en local (Japón, @local).
 *
 * D49: al pasar el ratón por un punto del ritmo sale su ficha (Esc la oculta sin cerrar la hoja); en táctil, un toque la
 * fija sin saltar en el tiempo y su botón salta a la vuelta; el coche elegido se quita desde la cabecera de la hoja.
 * Desde la hoja se elige a otro piloto (su selector «Elegido ALO ▾», un clic en su punto o «Elegir» en su ficha
 * fijada) y, si la cámara seguía al anterior, pasa a seguirlo; «Ninguno» lo quita.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { gotoApp, resetStorage, settled } from './helpers'

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
  await settled(page)
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

  // Un clic en la gráfica fuera de los puntos (puntero en cruz) salta al inicio de la vuelta más cercana (antes del final
  // de los datos) y no elige a nadie.
  const spot = await offSeries(page)
  expect(await chart.locator('.u-over').evaluate((el) => getComputedStyle(el).cursor)).toBe('crosshair')
  await page.mouse.click(spot.x, spot.y)
  await expect.poll(() => page.evaluate(() => window.__trazada!.timeMs)).toBeLessThan(endMs)
  expect(await selected(page)).toBeNull()

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
    // Tres pasadas de axe (y, desde D49, un círculo por piloto en la leyenda): con la máquina cargada, más de 30 s.
    test.setTimeout(60_000)
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

// --- D49: ficha de cada serie y coche elegido en la hoja ---

const card = (page: Page) => page.getByTestId('analysis-card')

const oneFrame = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(r)))

/**
 * Busca con el ratón un punto del ritmo (barre en vertical unas cuantas columnas del área de datos) hasta que la gráfica
 * resalta una serie; devuelve dónde. Un punto se toca a 12 px: con pasos de 10 px en vertical no se salta ninguno que
 * quede a menos de 6 px de la columna. La gráfica mira el puntero en el frame siguiente a moverlo.
 */
async function hoverAPoint(page: Page, testid = 'pace-chart', not: string | null = null): Promise<{ x: number; y: number; car: string }> {
  const chart = page.getByTestId(testid)
  const box = (await chart.locator('.u-over').boundingBox())!
  for (const fx of [0.5, 0.35, 0.65, 0.2, 0.8, 0.45, 0.55]) {
    const x = box.x + box.width * fx
    for (let y = box.y + 2; y < box.y + box.height; y += 10) {
      await page.mouse.move(x, y)
      await oneFrame(page)
      const car = await chart.getAttribute('data-preview')
      if (car && car !== not) return { x, y, car }
    }
  }
  throw new Error('ningún punto bajo el ratón')
}

/** Un punto del área de datos sin ninguna serie debajo (puntero en cruz): un clic ahí salta a la vuelta más cercana. */
async function offSeries(page: Page, testid = 'pace-chart'): Promise<{ x: number; y: number }> {
  const chart = page.getByTestId(testid)
  const box = (await chart.locator('.u-over').boundingBox())!
  for (const fy of [0.5, 0.3, 0.7, 0.15, 0.85]) {
    for (const fx of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8]) {
      const x = box.x + box.width * fx
      const y = box.y + box.height * fy
      await page.mouse.move(x, y)
      await twoFrames(page)
      if ((await chart.getAttribute('data-preview')) === null) return { x, y }
    }
  }
  throw new Error('ningún hueco sin series')
}

const selected = (page: Page) => page.evaluate(() => window.__trazada!.selectedCar)

/** Coches con posición en el instante actual. */
const onTrack = (page: Page) =>
  page.evaluate(() =>
    window
      .__trazada!.cars()
      .filter((c) => c.visible)
      .map(({ car, x, y }) => ({ car, x, y })),
  )

/**
 * Con la hoja cerrada, la cámara sigue a `car`: modo de seguimiento y, en horizontal, a la distancia de seguimiento de
 * él (70 m por defecto) y más cerca de él que de `other` (si está en pista).
 */
async function expectFollowing(page: Page, car: string, other: string | null) {
  await expect.poll(() => page.evaluate(() => window.__trazada!.scene.cameraMode), { timeout: 10_000 }).toBe('follow')
  const distanceTo = (c: string) =>
    page.evaluate((target) => {
      const [x, , z] = window.__trazada!.scene.camera
      const st = window.__trazada!.cars().find((s) => s.car === target && s.visible)
      return st ? Math.hypot(x - st.x, z + st.y) : null
    }, c)
  await expect.poll(() => distanceTo(car), { timeout: 10_000 }).toBeLessThan(100)
  const d = (await distanceTo(car))!
  const o = other ? await distanceTo(other) : null
  if (o !== null) expect(d).toBeLessThan(o)
}

/** Sigue al primero de la clasificación (botón de su fila y «Seguir»); devuelve su número. */
async function followFirst(page: Page, touch = false): Promise<string> {
  const row = page.locator('[data-testid="leaderboard"] [data-car]').first()
  const car = (await row.getAttribute('data-car'))!
  if (touch) await row.getByRole('button').tap()
  else await row.getByRole('button').click()
  if (touch) await page.getByTestId('follow-toggle').tap()
  else await page.getByTestId('follow-toggle').click()
  await expect(page.getByTestId('follow-toggle')).toHaveAttribute('aria-pressed', 'true')
  return car
}

test('ritmo: al pasar el ratón por un punto, su ficha (sigla y «Clic: elegir …», con la mano); al salir se va; Esc la oculta sin cerrar la hoja', async ({
  page,
}) => {
  // Busca un punto con el ratón (un frame por paso): con la máquina cargada, más de 30 s.
  test.setTimeout(60_000)
  await openReplay(page)
  await seek(page, await page.evaluate(() => window.__trazada!.endMs))
  await openSheet(page)
  await expect(page.getByTestId('pace')).toHaveAttribute('data-axis', 'time')
  await expect(card(page)).toBeHidden()
  const hit = await hoverAPoint(page)
  await expect(card(page)).toBeVisible()
  await expect(card(page)).toHaveAttribute('data-mode', 'hover')
  await expect(card(page)).toHaveAttribute('role', 'tooltip')
  await expect(card(page)).toHaveAttribute('data-car', hit.car)
  const tla = page.getByTestId('analysis-card-head').locator('.tz-achart__card-tla')
  await expect(tla).toHaveText(/^[A-Z]{3}$/)
  // Sin coche elegido, un clic ahí lo elegiría: lo dice la ficha y el puntero es la mano.
  await expect(page.getByTestId('analysis-card-click')).toHaveText(`Clic: elegir ${await tla.textContent()}`)
  await expect(page.getByTestId('pace-chart')).toHaveAttribute('data-hit', 'true')
  expect(await page.getByTestId('pace-chart').locator('.u-over').evaluate((el) => getComputedStyle(el).cursor)).toBe('pointer')
  await expect(page.getByTestId('analysis-card-mark')).toHaveText(/vuelta representativa|excluida|anulada/)
  // Fuera de la gráfica, se va.
  await page.mouse.move(5, 5)
  await expect(card(page)).toBeHidden()
  // Esc la oculta y la hoja sigue abierta; otro Esc cierra la hoja.
  await page.mouse.move(hit.x, hit.y)
  await expect(card(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(card(page)).toBeHidden()
  await expect(sheet(page)).toBeVisible()
  await page.mouse.move(5, 5)
  await page.keyboard.press('Escape')
  await expect(sheet(page)).toHaveCount(0)
})

test('coche elegido en la hoja: el chip lo dice y su × lo quita (sin destacar, sin selección); al cerrar, vista general sin telemetría', async ({
  page,
}) => {
  await openReplay(page)
  await seek(page, await page.evaluate(() => window.__trazada!.endMs))
  const car = (await page.locator('[data-testid="leaderboard"] [data-car]').first().getAttribute('data-car'))!
  await page.locator(`[data-testid="leaderboard"] [data-car="${car}"]`).first().getByRole('button').click()
  await expect(page.getByTestId('telemetry')).toBeVisible()
  await openSheet(page)
  const chip = page.getByTestId('analysis-selection')
  await expect(chip).toBeVisible()
  await expect(chip).toHaveAttribute('data-car', car)
  await expect(chip.locator('.tz-aselect__label')).toHaveText('Elegido')
  await expect(page.locator('[data-testid="pace-chart"] .tz-achart__key.is-emphasis')).toHaveCount(1)
  await page.getByTestId('analysis-selection-clear').click()
  // El control se queda para elegir otro: «Elegir piloto ▾», sin ×, con el foco.
  await expect(chip).not.toHaveAttribute('data-car')
  await expect(page.getByTestId('analysis-selection-clear')).toHaveCount(0)
  await expect(page.getByTestId('analysis-selection-picker')).toHaveText('Elegir piloto')
  await expect(page.locator('[data-testid="pace-chart"] .tz-achart__key.is-emphasis')).toHaveCount(0)
  expect(await page.evaluate(() => window.__trazada!.selectedCar)).toBeNull()
  await expect(page.getByTestId('analysis-selection-picker')).toBeFocused()
  // El coche sigue en «Ritmo» (se congelan los visibles), ya sin destacar.
  await expect(page.locator(`[data-testid="pace-chart"] [data-testid="analysis-legend-item"][data-car="${car}"]`)).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('analysis-close').click()
  await expect(sheet(page)).toHaveCount(0)
  await expect(page.getByTestId('telemetry')).toHaveCount(0)
})

for (const lang of ['es', 'en'] as const) {
  test(`accesible (axe) con el chip del coche elegido y una ficha a la vista (${lang})`, async ({ page, baseURL }) => {
    // Busca un punto con el ratón y luego pasa axe: con la suite entera en paralelo, más de 30 s.
    test.setTimeout(90_000)
    await openReplay(page, baseURL, lang)
    await seek(page, await page.evaluate(() => window.__trazada!.endMs))
    await page.locator('[data-testid="leaderboard"] [data-car]').first().getByRole('button').click()
    await page.getByTestId('follow-toggle').click()
    await openSheet(page)
    await expect(page.getByTestId('analysis-selection')).toHaveAttribute('data-following', 'true')
    await hoverAPoint(page)
    await expect(card(page)).toBeVisible()
    expect(await serious(page)).toEqual([])
  })
}

test.describe('táctil 1024×768 (D49)', () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true })

  test('un toque fija la ficha sin mover el reloj; su botón salta a esa vuelta y la cierra; un toque fuera la cierra', async ({ page }) => {
    test.setTimeout(60_000)
    await openReplay(page)
    const endMs = await page.evaluate(() => window.__trazada!.endMs)
    await seek(page, endMs)
    await openSheet(page)
    // Dónde hay un punto (con el ratón) y adónde salta un clic en él: el primero elige a su piloto (sin saltar) y el
    // segundo, ya en el elegido, salta. Luego se quita la selección.
    const hit = await hoverAPoint(page)
    await page.mouse.click(hit.x, hit.y)
    await expect.poll(() => selected(page)).toBe(hit.car)
    expect(await page.evaluate(() => window.__trazada!.timeMs)).toBe(endMs)
    await page.mouse.click(hit.x, hit.y)
    await expect.poll(() => page.evaluate(() => window.__trazada!.timeMs)).not.toBe(endMs)
    const target = await page.evaluate(() => window.__trazada!.timeMs)
    await page.mouse.move(2, 2)
    await expect(card(page)).toBeHidden()
    await page.getByTestId('analysis-selection-clear').click()
    expect(await selected(page)).toBeNull()
    await seek(page, endMs)

    await page.touchscreen.tap(hit.x, hit.y)
    await expect(card(page)).toHaveAttribute('data-mode', 'pinned')
    await expect(card(page)).toHaveAttribute('role', 'group')
    await expect(card(page)).toBeVisible()
    expect(await page.evaluate(() => window.__trazada!.timeMs)).toBe(endMs)
    const go = page.getByTestId('analysis-card-go')
    await expect(go).toHaveText(/ir al inicio de esa vuelta/i)
    expect((await go.boundingBox())!.height).toBeGreaterThanOrEqual(31.5)
    await go.tap()
    await expect.poll(() => page.evaluate(() => window.__trazada!.timeMs)).toBe(target)
    await expect(card(page)).toBeHidden()

    // Otra vez fijada: un toque fuera de la gráfica la cierra; la hoja sigue.
    await seek(page, endMs)
    await page.touchscreen.tap(hit.x, hit.y)
    await expect(card(page)).toHaveAttribute('data-mode', 'pinned')
    const title = (await page.locator('.tz-analysis__title').boundingBox())!
    await page.touchscreen.tap(title.x + 5, title.y + title.height / 2)
    await expect(card(page)).toBeHidden()
    await expect(sheet(page)).toBeVisible()
    expect(await page.evaluate(() => window.__trazada!.timeMs)).toBe(endMs)
  })
})

for (const vp of [
  { name: 'iPad horizontal 1024×768', width: 1024, height: 768 },
  { name: 'iPad vertical 768×1024', width: 768, height: 1024 },
]) {
  test.describe(`${vp.name} táctil, con el coche elegido (D49)`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, hasTouch: true })

    test('la cabecera de la hoja no se desborda con el chip; su × tiene zona táctil', async ({ page }) => {
      await openReplay(page)
      await page.locator('[data-testid="leaderboard"] [data-car]').first().getByRole('button').tap()
      await page.getByTestId('follow-toggle').tap()
      await openSheet(page)
      const chip = page.getByTestId('analysis-selection')
      await expect(chip).toBeVisible()
      // Nada de la cabecera (título, chip, «Sin spoilers», ⓘ, ×) se sale de ella; si no cabe, pasa a otra fila. Las zonas
      // táctiles (::after) pueden asomar a propósito: se miden las cajas.
      const overflow = await page.evaluate(() => {
        const head = document.querySelector('.tz-analysis__head')!.getBoundingClientRect()
        const sheet = document.querySelector('[data-testid="analysis-sheet"]')!
        const doc = document.documentElement
        const parts = [...document.querySelectorAll('.tz-analysis__head > *, .tz-analysis__actions > *')]
        const out = parts.filter((el) => {
          const r = el.getBoundingClientRect()
          return r.left < head.left - 0.5 || r.right > head.right + 0.5
        })
        return { page: doc.scrollWidth > doc.clientWidth, sheet: sheet.scrollWidth > sheet.clientWidth, head: out.map((el) => el.className) }
      })
      expect(overflow).toEqual({ page: false, sheet: false, head: [] })
      const chipBox = (await chip.boundingBox())!
      const sheetBox = (await sheet(page).boundingBox())!
      expect(chipBox.x + chipBox.width).toBeLessThanOrEqual(sheetBox.x + sheetBox.width)
      // La zona táctil del × (su ::after) llega a --tz-hit-min con puntero grueso.
      const hit = await page.getByTestId('analysis-selection-clear').evaluate((el) => {
        const after = getComputedStyle(el, '::after')
        const r = el.getBoundingClientRect()
        return { coarse: matchMedia('(pointer: coarse)').matches, h: r.height - 2 * Number.parseFloat(after.top) }
      })
      expect(hit.h).toBeGreaterThanOrEqual(hit.coarse ? 43.5 : 23.5)
      // Por debajo de 900 px, sin «la cámara lo sigue».
      if (vp.width < 900) await expect(chip.locator('.tz-aselect__follow')).toBeHidden()
    })
  })
}

// --- D49: elegir a otro piloto (o ninguno) sin salir de la hoja ---

/** Un instante del fixture (9 min de libres) con los 22 coches en pista: la cámara de seguimiento tiene a quién seguir. */
const ON_TRACK_MS = 4 * 60_000

for (const vp of [
  { name: 'escritorio 1440×900', width: 1440, height: 900, touch: false },
  { name: 'iPad horizontal 1024×768 táctil', width: 1024, height: 768, touch: true },
]) {
  test.describe(`${vp.name}: elegir otro piloto desde la hoja (D49)`, () => {
    // Movimiento reducido: la cámara pasa al coche sin vuelo (con la máquina cargada, el vuelo de GSAP se alarga mucho), y
    // lo que se prueba es a qué coche sigue.
    test.use({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, reducedMotion: 'reduce' })

    test('desde el selector «Elegido ▾»: la lista con «Ninguno» y cada piloto; al elegir a otro, la cámara pasa a seguirlo', async ({
      page,
    }) => {
      test.setTimeout(90_000)
      await openReplay(page)
      const startMs = await page.evaluate(() => window.__trazada!.startMs)
      await seek(page, startMs + ON_TRACK_MS)
      const first = await followFirst(page, vp.touch)
      await openSheet(page)
      const chip = page.getByTestId('analysis-selection')
      await expect(chip).toHaveAttribute('data-car', first)
      await expect(chip).toHaveAttribute('data-following', 'true')

      // El coche en pista más lejos del que se sigue: se ve que la cámara cambia de coche.
      const cars = await onTrack(page)
      const from = cars.find((c) => c.car === first)!
      expect(from).toBeTruthy()
      const other = cars.filter((c) => c.car !== first).sort((a, b) => Math.hypot(b.x - from.x, b.y - from.y) - Math.hypot(a.x - from.x, a.y - from.y))[0]!
      const picker = page.getByTestId('analysis-selection-picker')
      await expect(picker).toHaveAttribute('aria-haspopup', 'listbox')
      if (vp.touch) await picker.tap()
      else await picker.click()
      const list = page.getByTestId('analysis-selection-list')
      await expect(list).toBeVisible()
      await expect(picker).toHaveAttribute('aria-expanded', 'true')
      const options = list.getByTestId('analysis-selection-option')
      expect(await options.count()).toBe((await page.evaluate(() => window.__trazada!.drivers.length)) + 1)
      await expect(options.first()).toContainText('Ninguno')
      await expect(list.locator(`[data-car="${first}"]`)).toHaveAttribute('aria-selected', 'true')
      // Dentro de la hoja (que recorta) y con las opciones de --tz-hit-min de alto (44 px con el dedo).
      const lb = (await list.boundingBox())!
      const sb = (await sheet(page).boundingBox())!
      expect(lb.y + lb.height).toBeLessThanOrEqual(sb.y + sb.height + 0.5)
      expect(lb.x + lb.width).toBeLessThanOrEqual(sb.x + sb.width + 0.5)
      const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches)
      expect((await options.nth(1).boundingBox())!.height).toBeGreaterThanOrEqual(coarse ? 43.5 : 31.5)

      const option = list.locator(`[data-car="${other.car}"]`)
      await option.scrollIntoViewIfNeeded()
      if (vp.touch) await option.tap()
      else await option.click()
      await expect(list).toHaveCount(0)
      await expect(chip).toHaveAttribute('data-car', other.car)
      await expect(chip).toHaveAttribute('data-following', 'true')
      expect(await selected(page)).toBe(other.car)
      await expect(sheet(page)).toBeVisible()
      if (!vp.touch) await expect(picker).toBeFocused()
      // Cerrada la hoja, la cámara sigue al nuevo.
      await page.getByTestId('analysis-close').click()
      await expect(sheet(page)).toHaveCount(0)
      await expectFollowing(page, other.car, first)
      await expect(page.getByTestId('follow-toggle')).toHaveAttribute('aria-pressed', 'true')
    })

    test('desde la gráfica: un punto de otro piloto lo elige (clic, o «Elegir» en su ficha con el dedo) y la cámara pasa a seguirlo', async ({
      page,
    }) => {
      test.setTimeout(90_000)
      await openReplay(page)
      const startMs = await page.evaluate(() => window.__trazada!.startMs)
      await seek(page, startMs + ON_TRACK_MS)
      const first = await followFirst(page, vp.touch)
      await openSheet(page)
      // La sesión entera, para tener puntos de todos (el instante no cambia).
      const spoilers = page.getByTestId('analysis-spoilers')
      if (vp.touch) await spoilers.tap()
      else await spoilers.click()
      await expect(spoilers).toHaveAttribute('aria-checked', 'false')
      const t0 = await page.evaluate(() => window.__trazada!.timeMs)
      // Un punto de otro piloto (con el ratón: dónde está).
      const hit = await hoverAPoint(page, 'pace-chart', first)
      const tla = (await page.getByTestId('analysis-card-head').locator('.tz-achart__card-tla').textContent())!
      if (vp.touch) {
        await page.mouse.move(2, 2)
        await page.touchscreen.tap(hit.x, hit.y)
        await expect(card(page)).toHaveAttribute('data-mode', 'pinned')
        await expect(card(page)).toHaveAttribute('data-car', hit.car)
        const choose = page.getByTestId('analysis-card-choose')
        await expect(choose).toHaveText('Elegir')
        await expect(choose).toHaveAccessibleName(`Elegir ${tla}`)
        await choose.tap()
      } else {
        await expect(page.getByTestId('analysis-card-click')).toHaveText(`Clic: elegir ${tla}`)
        await page.mouse.click(hit.x, hit.y)
      }
      await expect.poll(() => selected(page)).toBe(hit.car)
      // Elegir no salta en el tiempo; la ficha dice «Elegido» (y, con el ratón, que otro clic va a esa vuelta).
      expect(await page.evaluate(() => window.__trazada!.timeMs)).toBe(t0)
      await expect(page.getByTestId('analysis-selection')).toHaveAttribute('data-following', 'true')
      await expect(page.getByTestId('analysis-card-chosen')).toHaveText('Elegido')
      await expect(page.locator(`[data-testid="pace-chart"] [data-testid="analysis-legend-item"][data-car="${hit.car}"]`)).toHaveClass(/is-emphasis/)
      // El anterior sigue dibujado, ya sin destacar.
      await expect(page.locator(`[data-testid="pace-chart"] [data-testid="analysis-legend-item"][data-car="${first}"]`)).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      // Con el dedo, «Elegir» da paso a «Elegido»; con el ratón, otro clic ahí ya iría al inicio de esa vuelta (sin quitarlo:
      // lo prueba el toque fijado de arriba).
      if (vp.touch) await expect(page.getByTestId('analysis-card-choose')).toHaveCount(0)
      else await expect(page.getByTestId('analysis-card-click')).toHaveText('Clic: ir al inicio de esa vuelta')
      // Cerrada la hoja, la cámara sigue al nuevo (en este instante, todos en pista).
      if (vp.touch) await page.getByTestId('analysis-close').tap()
      else await page.getByTestId('analysis-close').click()
      await expect(sheet(page)).toHaveCount(0)
      await expectFollowing(page, hit.car, first)
    })
  })
}

test('la leyenda elige con su círculo (y con Intro en el nombre); el nombre sigue mostrando u ocultando', async ({ page }) => {
  test.setTimeout(90_000)
  await openReplay(page)
  await seek(page, await page.evaluate(() => window.__trazada!.endMs))
  const first = await followFirst(page)
  await openSheet(page)
  const chart = page.getByTestId('pace-chart')
  // Otro piloto de los que se ven: elegirlo no cambia que se vea.
  const shown = chart.locator('[data-testid="analysis-legend-item"][aria-pressed="true"]')
  const other = (await shown.evaluateAll((els, f) => els.map((e) => e.getAttribute('data-car')!).filter((c) => c !== f), first))[0]!
  const ring = chart.locator(`[data-testid="analysis-legend-pick"][data-pick="${other}"]`)
  await expect(ring).toHaveAttribute('aria-pressed', 'false')
  await expect(ring).toHaveAttribute('tabindex', '-1')
  await ring.click()
  await expect.poll(() => selected(page)).toBe(other)
  await expect(ring).toHaveAttribute('aria-pressed', 'true')
  await expect(chart.locator(`[data-testid="analysis-legend-item"][data-car="${other}"]`)).toHaveAttribute('aria-pressed', 'true')
  await expect(chart.locator(`[data-testid="analysis-legend-item"][data-car="${other}"]`)).toHaveClass(/is-emphasis/)
  await expect(page.getByTestId('analysis-selection')).toHaveAttribute('data-following', 'true')
  // Con el teclado: Intro en el nombre del primero lo vuelve a elegir; la ficha del foco dice las teclas.
  const firstKey = chart.locator(`[data-testid="analysis-legend-item"][data-car="${first}"]`)
  await firstKey.focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  await expect(firstKey).toBeFocused()
  await expect(page.getByTestId('analysis-card-keys')).toContainText('Intro: elegir')
  await page.keyboard.press('Enter')
  await expect.poll(() => selected(page)).toBe(first)
  await expect(firstKey).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('analysis-card-keys')).toHaveText('Espacio: mostrar u ocultar')
  await expect(sheet(page)).toBeVisible()
})

for (const lang of ['es', 'en'] as const) {
  test(`accesible (axe) con el selector de piloto desplegado (${lang})`, async ({ page, baseURL }) => {
    test.setTimeout(90_000)
    await openReplay(page, baseURL, lang)
    await followFirst(page)
    await openSheet(page)
    await page.getByTestId('analysis-selection-picker').click()
    await expect(page.getByTestId('analysis-selection-list')).toBeVisible()
    expect(await serious(page)).toEqual([])
    // Esc cierra la lista (el foco vuelve al selector) y la hoja sigue abierta.
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('analysis-selection-list')).toHaveCount(0)
    await expect(page.getByTestId('analysis-selection-picker')).toBeFocused()
    await expect(sheet(page)).toBeVisible()
  })
}
