/**
 * Momentos (ítem 5, D35) con la carrera de Japón 2026 (datos completos de data/; fuente dev, nunca en un fixture):
 * adelantamientos confirmados en la línea y situados con el GPS, duelos a menos de 1 s, «Sin spoilers», el salto al
 * pulsar uno, el carril del timeline (sin crecer el timeline) y los botones del dock con la clase «Adelantamientos».
 * Las filas de duelo nunca se cortan (D49): un barrido de anchos en español y en inglés.
 * Solo en local, con un servidor aparte:
 *   E2E_DATA_DIR=../../data node tests/e2e/serve.mjs --port 4199
 *   E2E_LOCAL_URL=http://127.0.0.1:4199 pnpm e2e local-moments
 */
import { expect, type Page, test } from '@playwright/test'
import { markTipsSeen } from './helpers'

const BASE = process.env.E2E_LOCAL_URL
test.skip(!BASE, 'solo en local (E2E_LOCAL_URL con data/ servido)')

interface MomentsStat {
  overtakes: number
  located: number
  duels: number
  duelsStatus: string
  targets: { kind: string; t: number; seekMs: number }[]
}

async function open(page: Page) {
  await markTipsSeen(page)
  await page.goto(`${BASE}/replay?s=2026/03-suzuka/race`)
  await page.waitForFunction(() => window.__trazada?.scene.ready, null, { timeout: 30_000 })
}

const stat = (page: Page) => page.evaluate(() => window.__trazada!.scene.moments as MomentsStat)
const time = (page: Page) => page.evaluate(() => window.__trazada!.timeMs)
const twoFrames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))

test('adelantamientos y duelos de la carrera: «Sin spoilers», salto al pulsar y carril del timeline', async ({ page }) => {
  await open(page)
  const s = await stat(page)
  // Estudio del ítem 5: ~50 cambios de orden en la línea sin boxes (42 a menos de 30 s, todos con cruce GPS); ~39 duelos.
  expect(s.overtakes).toBeGreaterThan(20)
  expect(s.located).toBeGreaterThan(s.overtakes * 0.6)
  expect(s.duelsStatus).toBe('ok')
  expect(s.duels).toBeGreaterThan(10)

  // Al empezar, con «Sin spoilers», nada confirmado todavía: ni filas ni marcas.
  const lane = page.getByTestId('overtake-lane')
  await expect(lane).toHaveAttribute('data-ticks', '0')
  // El carril va en la franja de la pista por encima del riel: el timeline no crece.
  const track = (await page.getByTestId('timeline').boundingBox())!
  const band = (await lane.boundingBox())!
  expect(band.y).toBeGreaterThanOrEqual(track.y - 0.5)
  expect(band.y + band.height).toBeLessThanOrEqual(track.y + 6.5)

  await page.getByTestId('analysis-button').click()
  await page.getByTestId('analysis-tab-moments').click()
  await expect(page.getByTestId('overtakes-nothing-yet')).toBeVisible()

  // A mitad de carrera, solo lo confirmado hasta ahí.
  const { startMs, endMs } = await page.evaluate(() => ({ startMs: window.__trazada!.startMs, endMs: window.__trazada!.endMs }))
  await page.evaluate((t) => window.__trazada!.seek(t), (startMs + endMs) / 2)
  await twoFrames(page)
  const rows = page.getByTestId('overtake-row')
  await expect.poll(() => rows.count()).toBeGreaterThan(0)
  const half = await rows.count()
  expect(half).toBeLessThan(s.overtakes)
  await expect.poll(async () => Number(await lane.getAttribute('data-ticks'))).toBe(half)
  // El instante GPS lleva su etiqueta «Estimado».
  await expect(page.locator('[data-testid="moments-overtakes"] [data-testid="estimated"][data-field="overtakeTime"]')).toBeVisible()

  // Sin «Sin spoilers», todos.
  await page.getByTestId('analysis-spoilers').click()
  await expect.poll(() => rows.count()).toBe(s.overtakes)
  await expect.poll(() => page.getByTestId('duel-row').count()).toBe(s.duels)
  await expect.poll(async () => Number(await lane.getAttribute('data-ticks'))).toBe(s.overtakes)

  // Pulsar un adelantamiento con instante GPS: el reloj va 5 s antes y se elige al que adelanta.
  const row = page.locator('[data-testid="overtake-row"][data-located="true"]').first()
  const passer = (await row.getAttribute('data-passer'))!
  const lap = Number(await row.getAttribute('data-lap'))
  const target = s.targets.find((m) => m.kind === 'overtake')
  expect(target).toBeDefined()
  await row.click()
  await expect.poll(() => page.evaluate(() => window.__trazada!.selectedCar)).toBe(passer)
  const at = await time(page)
  expect(s.targets.some((m) => m.kind === 'overtake' && Math.abs(m.seekMs - at) < 1)).toBe(true)
  expect(lap).toBeGreaterThanOrEqual(2)

  // Un duelo: se elige al perseguidor y se compara con el de delante.
  const duel = page.getByTestId('duel-row').first()
  const chaser = (await duel.getAttribute('data-chaser'))!
  await duel.click()
  await expect.poll(() => page.evaluate(() => window.__trazada!.selectedCar)).toBe(chaser)
  await expect(page.getByTestId('compare')).toBeVisible()
})

test('los botones del dock con la clase «Adelantamientos» van de uno en uno', async ({ page }) => {
  await open(page)
  const s = await stat(page)
  const overtakes = s.targets.filter((m) => m.kind === 'overtake').map((m) => m.seekMs)
  await page.getByTestId('analysis-button').click()
  await page.getByTestId('analysis-tab-moments').click()
  await page.locator('[data-testid="moments-filter"] [data-filter="overtake"]').click()
  await page.getByTestId('analysis-close').click()

  const next = page.getByTestId('jump-next')
  // En el idioma del navegador (el de Playwright es inglés; con español, «adelantamientos»).
  await expect(next).toHaveAccessibleName(/adelantamientos|overtakes/)
  const start = await time(page)
  const expected = overtakes.filter((x) => x > start).slice(0, 3)
  for (const x of expected) {
    await next.click()
    await expect.poll(() => time(page)).toBe(x)
  }
})

test.describe('iPad vertical 768×1024', () => {
  test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true })

  test('un duelo que acabó en adelantamiento sigue diciendo entre quién es; su estado no se sale de la fila', async ({ page }) => {
    await open(page)
    await page.getByTestId('analysis-button').click()
    await page.getByTestId('analysis-tab-moments').click()
    await page.getByTestId('analysis-spoilers').click()
    const rows = page.locator('[data-testid="duel-row"]:has(.tz-moments__state)')
    await expect.poll(() => rows.count()).toBeGreaterThan(0)
    const boxes = await rows.evaluateAll((els) =>
      els.map((row) => {
        const col = row.closest('.tz-moments__col')!.getBoundingClientRect()
        const r = row.getBoundingClientRect()
        const who = row.querySelector('.tz-moments__who-text')!.getBoundingClientRect()
        const state = row.querySelector('.tz-moments__state')!.getBoundingClientRect()
        return { who: who.width, state: state.right, row: r.right, col: col.right, text: row.textContent }
      }),
    )
    for (const b of boxes) {
      // Las dos siglas a la vista (no una columna de 0 px); el chip, dentro de la fila, y la fila, dentro de la columna.
      expect(b.who, b.text!).toBeGreaterThan(40)
      expect(b.state, b.text!).toBeLessThanOrEqual(b.row + 0.5)
      expect(b.row, b.text!).toBeLessThanOrEqual(b.col + 0.5)
    }
  })
})

/**
 * D49: entre 932 y 995 px el chip «terminó en adelantamiento» salía cortado («terminó en adelanta…»). Ahora el cuerpo de
 * la fila se parte en líneas: en cada ancho, ni el chip, ni los nombres, ni «mín.» se cortan; todo queda dentro de su
 * fila, la fila dentro de su columna y la página sin scroll horizontal.
 */
for (const lang of ['es', 'en'] as const) {
  for (const vp of [
    { width: 768, height: 1024, touch: true },
    { width: 932, height: 990, touch: false },
    { width: 960, height: 990, touch: false },
    { width: 996, height: 990, touch: false },
    { width: 1024, height: 768, touch: false },
    { width: 1280, height: 800, touch: false },
    { width: 1440, height: 900, touch: false },
    { width: 1760, height: 990, touch: false },
    { width: 1920, height: 1080, touch: false },
  ]) {
    test.describe(`filas de duelo a ${vp.width} px${vp.touch ? ' táctil' : ''} (${lang})`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch })

      test('nada se corta ni se sale de su fila', async ({ page }) => {
        await page.context().addCookies([{ name: 'trazada_lang', value: lang, url: BASE! }])
        await open(page)
        await page.getByTestId('analysis-button').click()
        await page.getByTestId('analysis-tab-moments').click()
        await page.getByTestId('analysis-spoilers').click()
        const rows = page.locator('[data-testid="duel-row"]:has(.tz-moments__state)')
        await expect.poll(() => rows.count()).toBeGreaterThan(0)
        const bad = await page.evaluate(() => {
          const out: string[] = []
          for (const row of document.querySelectorAll<HTMLElement>('[data-testid="duel-row"]')) {
            const r = row.getBoundingClientRect()
            const col = row.closest('.tz-moments__col')!.getBoundingClientRect()
            if (r.right > col.right + 0.5) out.push(`fila fuera de su columna: ${row.textContent}`)
            for (const el of row.querySelectorAll<HTMLElement>('.tz-moments__who-text, .tz-moments__when, .tz-moments__state, .tz-moments__lap')) {
              const e = el.getBoundingClientRect()
              if (el.scrollWidth > el.clientWidth + 1) out.push(`cortado: ${el.textContent}`)
              if (e.right > r.right + 0.5 || e.left < r.left - 0.5) out.push(`fuera de la fila: ${el.textContent}`)
            }
          }
          const doc = document.documentElement
          if (doc.scrollWidth > doc.clientWidth) out.push('scroll horizontal')
          return out
        })
        expect(bad).toEqual([])
      })
    })
  }
}

/**
 * D49, revisión: a 768 px en español, «Solo dirección de carrera ×» pasaba el reloj del dock a una segunda fila (el dock
 * crecía unos 40 px y la hoja encogía). Por debajo de 900 px el chip dice solo la clase y, si no cabe, la corta con «…».
 */
for (const lang of ['es', 'en'] as const) {
  test.describe(`chip del dock a 768 px táctil (${lang})`, () => {
    test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true })

    test('con cualquier clase elegida, el dock no crece ni se desborda', async ({ page }) => {
      await page.context().addCookies([{ name: 'trazada_lang', value: lang, url: BASE! }])
      await open(page)
      await page.getByTestId('analysis-button').tap()
      await page.getByTestId('analysis-tab-moments').tap()
      const dock = page.getByTestId('replay-dock')
      const before = (await dock.boundingBox())!.height
      for (const kind of ['overtake', 'duel', 'neutralisation', 'raceControl']) {
        await page.locator(`[data-testid="moments-filter"] [data-filter="${kind}"]`).tap()
        await expect(page.getByTestId('jump-filter-chip')).toBeVisible()
        expect((await dock.boundingBox())!.height, kind).toBe(before)
        const overflow = await dock.evaluate((el) => el.scrollWidth > el.clientWidth)
        expect(overflow, kind).toBe(false)
      }
    })
  })
}
