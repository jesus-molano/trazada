/**
 * Momentos (ítem 5, D35) con la carrera de Japón 2026 (datos completos de data/; fuente dev, nunca en un fixture):
 * adelantamientos confirmados en la línea y situados con el GPS, duelos a menos de 1 s, «Sin spoilers», el salto al
 * pulsar uno, el carril del timeline (sin crecer el timeline) y los botones del dock con la clase «Adelantamientos».
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
