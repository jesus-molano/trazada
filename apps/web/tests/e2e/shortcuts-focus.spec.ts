/**
 * Atajos con el foco donde lo deja el uso normal (fixture de Spa, libres 1): tras pulsar el timeline, elegir rival en
 * el desplegable de la comparación o marcar la casilla de las banderas azules, Esc sigue cerrando lo de encima y los
 * atajos de una tecla (T, coma y punto, «/», espacio) siguen funcionando. Por eso aquí nunca se hace clic en el título
 * antes de las teclas: el foco se queda en el control.
 */
import { expect, type Page, test } from '@playwright/test'
import { gotoApp } from './helpers'

const FP1 = '/replay?s=2026/10-spa-francorchamps/fp1'

const twoFrames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
const mode = (page: Page) => page.evaluate(() => window.__trazada!.scene.cameraMode)
const tvActive = (page: Page) => page.evaluate(() => (window.__trazada!.scene.tv as { active: boolean }).active)
const time = (page: Page) => page.evaluate(() => window.__trazada!.timeMs)
const playing = (page: Page) => page.evaluate(() => window.__trazada!.playing)
const paletteOpen = (page: Page) => page.evaluate(() => (window.__trazada!.scene.palette as { open: boolean } | undefined)?.open ?? false)
const selected = (page: Page) => page.evaluate(() => window.__trazada!.selectedCar)
const timeline = (page: Page) => page.getByTestId('timeline')

async function openScene(page: Page) {
  await gotoApp(page, FP1)
  await expect.poll(async () => (await page.evaluate(() => window.__trazada?.scene.ready)) ?? false, { timeout: 15_000 }).toBe(true)
}

/**
 * Clic en el timeline en la fracción `f` del extracto: el reloj salta ahí y el foco se queda en el timeline. Después
 * el ratón sale de la pista (sin la tarjeta de la vista previa, que se quedaría el primer Esc).
 */
async function clickTimeline(page: Page, f: number) {
  const box = (await timeline(page).boundingBox())!
  await page.mouse.click(box.x + box.width * f, box.y + box.height / 2)
  await page.mouse.move(box.x + box.width * f, box.y - 200)
  await twoFrames(page)
  await expect(timeline(page)).toBeFocused()
  await expect(page.getByTestId('timeline-preview')).toBeHidden()
}

test('tras un clic en el timeline, Esc cierra la hoja de análisis', async ({ page }) => {
  await openScene(page)
  await page.getByTestId('analysis-button').click()
  await expect(page.getByTestId('analysis-sheet')).toBeVisible()
  await clickTimeline(page, 0.5)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('analysis-sheet')).toHaveCount(0)
})

test('tras un clic en el timeline, la T enciende y apaga la realización automática y Esc la apaga', async ({ page }) => {
  await openScene(page)
  // A unos 150 s del extracto hay coches en pista y parejas cerca (tv.spec.ts).
  await clickTimeline(page, 0.28)
  await page.keyboard.press('t')
  await expect.poll(() => mode(page), { timeout: 5000 }).toBe('tv')
  await expect(timeline(page)).toBeFocused()
  await page.keyboard.press('t')
  await expect.poll(() => tvActive(page)).toBe(false)
  await expect.poll(() => mode(page), { timeout: 5000 }).toBe('overview')

  await page.keyboard.press('t')
  await expect.poll(() => mode(page), { timeout: 5000 }).toBe('tv')
  // Un salto con el timeline no la apaga; Esc sí, con el foco aún en él.
  await clickTimeline(page, 0.3)
  expect(await tvActive(page)).toBe(true)
  await page.keyboard.press('Escape')
  await expect.poll(() => tvActive(page)).toBe(false)
  await expect.poll(() => mode(page), { timeout: 5000 }).toBe('overview')
})

test('tras elegir rival en el desplegable de la comparación, Esc la cierra (y el siguiente, la selección)', async ({ page }) => {
  await openScene(page)
  await page.evaluate((t) => window.__trazada!.seek(t), 4_470_000)
  await twoFrames(page)
  await page.locator('[data-testid="leaderboard"] [data-car="10"]').getByRole('button').click()
  await expect(page.getByTestId('telemetry')).toHaveAttribute('data-car', '10')
  await page.getByTestId('compare-toggle').click()
  const rival = page.getByTestId('compare-car')
  await rival.focus()
  await rival.selectOption('23')
  await expect(rival).toBeFocused()
  await expect(rival).toHaveValue('23')

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('compare')).toHaveCount(0)
  await expect(page.getByTestId('compare-toggle')).toHaveAttribute('aria-pressed', 'false')
  expect(await selected(page)).toBe('10')
  await page.keyboard.press('Escape')
  await expect.poll(() => selected(page)).toBeNull()
})

test('tras un clic en el timeline, el punto salta al momento siguiente, el espacio reproduce y «/» abre la paleta', async ({ page }) => {
  await openScene(page)
  const targets = await page.evaluate(() => (window.__trazada!.scene.moments as { targets: { seekMs: number }[] }).targets.map((m) => m.seekMs))
  expect(targets.length).toBeGreaterThanOrEqual(2)
  await clickTimeline(page, 0.02)
  const t0 = await time(page)
  const ahead = targets.filter((x) => x > t0).sort((a, b) => a - b)
  expect(ahead.length).toBeGreaterThanOrEqual(2)
  await page.keyboard.press('.')
  await expect.poll(() => time(page)).toBe(ahead[0])

  await page.keyboard.press(' ')
  await expect.poll(() => playing(page)).toBe(true)
  await page.keyboard.press(' ')
  await expect.poll(() => playing(page)).toBe(false)
  await expect(timeline(page)).toBeFocused()

  // La paleta se abre desde el timeline y, al cerrarse con Esc, le devuelve el foco: los atajos siguen.
  await page.keyboard.press('/')
  await expect.poll(() => paletteOpen(page)).toBe(true)
  await page.keyboard.press('Escape')
  await expect.poll(() => paletteOpen(page)).toBe(false)
  await expect(timeline(page)).toBeFocused()
  await page.keyboard.press('.')
  await expect.poll(() => time(page)).toBe(ahead[1])
})

test('tras un clic en la casilla de las banderas azules: el espacio reproduce (sin desmarcarla) y la T sigue', async ({ page }) => {
  await openScene(page)
  await page.evaluate((t) => window.__trazada!.seek(window.__trazada!.startMs + t), 150_000)
  await twoFrames(page)
  const blue = page.getByTestId('toggle-blue-flags')
  const before = await blue.isChecked()
  await blue.click()
  await expect(blue).toBeFocused()
  await expect(blue).toBeChecked({ checked: !before })

  await page.keyboard.press(' ')
  await expect.poll(() => playing(page)).toBe(true)
  await expect(blue).toBeChecked({ checked: !before })
  await page.keyboard.press(' ')
  await expect.poll(() => playing(page)).toBe(false)

  await page.keyboard.press('t')
  await expect.poll(() => mode(page), { timeout: 5000 }).toBe('tv')
  await page.keyboard.press('Escape')
  await expect.poll(() => tvActive(page)).toBe(false)
})
