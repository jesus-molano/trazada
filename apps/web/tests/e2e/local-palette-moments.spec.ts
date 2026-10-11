/**
 * Comandos de momentos en la paleta (ítem 14b, con los momentos del ítem 5, D35) con la carrera de Japón 2026 (datos
 * completos de data/; fuente dev, nunca en un fixture): «siguiente adelantamiento» va adonde va el botón del dock con
 * la clase «Adelantamientos» (5 s antes), sin decir quién mientras la línea no lo confirma («Sin spoilers») y con
 * «Estimado» en el instante GPS; «adelantamientos de <piloto>» elige a ese piloto; «siguiente duelo» compara al
 * perseguidor con el de delante. Solo en local, con un servidor aparte:
 *   E2E_DATA_DIR=../../data node tests/e2e/serve.mjs --port 4199
 *   E2E_LOCAL_URL=http://127.0.0.1:4199 pnpm e2e local-palette-moments
 */
import { expect, type Page, test } from '@playwright/test'
import { markTipsSeen } from './helpers'

const BASE = process.env.E2E_LOCAL_URL
test.skip(!BASE, 'solo en local (E2E_LOCAL_URL con data/ servido)')

interface MomentsStat {
  overtakes: number
  duels: number
  targets: { kind: string; t: number; seekMs: number }[]
}

async function open(page: Page) {
  await markTipsSeen(page)
  await page.goto(`${BASE}/replay?s=2026/03-suzuka/race`)
  await page.waitForFunction(() => window.__trazada?.scene.ready, null, { timeout: 30_000 })
  // Foco en la página sin tocar el lienzo (un clic ahí selecciona un coche).
  await page.getByTestId('replay-title').click()
}

const stat = (page: Page) => page.evaluate(() => window.__trazada!.scene.moments as MomentsStat)
const time = (page: Page) => page.evaluate(() => window.__trazada!.timeMs)
const selected = (page: Page) => page.evaluate(() => window.__trazada!.selectedCar)
const twoFrames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))

const palette = (page: Page) => page.getByTestId('command-palette')
const input = (page: Page) => page.getByTestId('palette-input')
const active = (page: Page) => page.locator('[data-testid="palette-option"][data-active="true"]')

async function command(page: Page, text: string, key: string | RegExp) {
  if (!(await palette(page).isVisible())) {
    await page.keyboard.press('Control+k')
    await expect(palette(page)).toBeVisible()
  }
  await input(page).fill(text)
  await expect(active(page)).toHaveAttribute('data-key', key)
}

test('«siguiente adelantamiento»: el mismo destino que el botón del dock, sin spoilers y con «Estimado»', async ({ page }) => {
  await open(page)
  const s = await stat(page)
  expect(s.overtakes).toBeGreaterThan(20)
  const now = await time(page)
  const expected = s.targets
    .filter((m) => m.kind === 'overtake' && m.seekMs > now)
    .map((m) => m.seekMs)
    .sort((a, b) => a - b)[0]!

  await command(page, 'siguiente adelantamiento', 'moments.overtake.next')
  await expect(active(page)).toHaveAttribute('data-t', String(Math.round(expected)))
  // Al empezar, la línea aún no ha confirmado nada: ni quién ni a quién, ni el color de su equipo.
  await expect(active(page)).toContainText(/sin spoilers|no spoilers/)
  await expect(active(page).locator('.tz-palette__team')).toHaveCount(0)
  await page.keyboard.press('Enter')
  await expect(palette(page)).toBeHidden()
  await twoFrames(page)
  expect(Math.abs((await time(page)) - expected)).toBeLessThan(1)
  expect(await selected(page)).not.toBeNull()

  // Ya confirmado al final de la carrera: con nombres; con instante GPS, su «Estimado».
  const { endMs } = await page.evaluate(() => ({ endMs: window.__trazada!.endMs }))
  await page.evaluate((t) => window.__trazada!.seek(t), endMs)
  await twoFrames(page)
  await command(page, 'adelantamiento anterior', 'moments.overtake.prev')
  await expect(active(page)).toContainText(/adelanta a|passes/)
})

test('«adelantamientos de <piloto>» elige a ese piloto; «siguiente duelo» lo compara con el de delante', async ({ page }) => {
  await open(page)
  const s = await stat(page)
  expect(s.duels).toBeGreaterThan(10)

  // VER: su siguiente adelantamiento (adelantando o adelantado) o, si no hay, deshabilitado con su motivo.
  await command(page, 'siguiente adelantamiento de VER', /^moments\.overtake\.next\.\d+$/)
  const key = (await active(page).getAttribute('data-key'))!
  const car = key.split('.').pop()!
  if ((await active(page).getAttribute('aria-disabled')) === 'true') {
    await expect(active(page).getByTestId('palette-reason')).toContainText(/Sin dato|No data|Ninguno|None/)
  } else {
    await page.keyboard.press('Enter')
    await expect.poll(() => selected(page)).toBe(car)
  }

  await command(page, 'siguiente duelo', 'moments.duel.next')
  const duelAt = Number(await active(page).getAttribute('data-t'))
  expect(s.targets.some((m) => m.kind === 'duel' && Math.abs(m.seekMs - duelAt) < 1)).toBe(true)
  await page.keyboard.press('Enter')
  await expect(palette(page)).toBeHidden()
  await expect.poll(() => time(page)).toBe(duelAt)
  await expect(page.getByTestId('compare')).toBeVisible()
})
