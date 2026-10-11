/**
 * Vista previa del timeline (ítem 16) con la carrera de Japón 2026 de data/ (datos completos; fuente dev, nunca en un
 * fixture). Solo en local, con un servidor aparte:
 *   E2E_DATA_DIR=../../data node tests/e2e/serve.mjs --port 4199
 *   E2E_LOCAL_URL=http://127.0.0.1:4199 pnpm e2e local-preview
 */
import { expect, type Page, test } from '@playwright/test'
import { markTipsSeen } from './helpers'

const BASE = process.env.E2E_LOCAL_URL
test.skip(!BASE, 'solo en local (E2E_LOCAL_URL con data/ servido)')

const handle = <T>(page: Page, fn: (h: NonNullable<Window['__trazada']>) => T) =>
  page.evaluate(`(${fn.toString()})(window.__trazada)`) as Promise<T>

async function open(page: Page) {
  await markTipsSeen(page)
  await page.goto(`${BASE}/replay?s=2026/03-suzuka/race`)
  await page.waitForFunction(() => window.__trazada?.scene.ready, null, { timeout: 30_000 })
}

const card = (page: Page) => page.getByTestId('timeline-preview')

/** Pasa el ratón por el instante t y devuelve el instante exacto de la tarjeta (a menos de 2 px de t). */
async function hoverAt(page: Page, t: number) {
  const box = (await page.getByTestId('timeline').boundingBox())!
  const { startMs, endMs } = await handle(page, (h) => ({ startMs: h.startMs, endMs: h.endMs }))
  const msPerPx = (endMs - startMs) / box.width
  await page.mouse.move(box.x + (t - startMs) / msPerPx, box.y + box.height / 2)
  await expect(card(page)).toBeVisible()
  await expect.poll(async () => Math.abs(Number(await card(page).getAttribute('data-t')) - t)).toBeLessThan(2 * msPerPx)
  return Number(await card(page).getAttribute('data-t'))
}

/** Primero de la clasificación en t (posición conocida), tras asentarse (se publica cada 150 ms). */
async function leaderboardFirst(page: Page, t: number): Promise<string | null> {
  await page.evaluate((x) => window.__trazada!.seek(x), t)
  const first = page.locator('[data-testid="leaderboard"] [data-car]').first()
  let prev = ''
  for (;;) {
    await page.waitForTimeout(400)
    const now = `${await first.getAttribute('data-car')}|${await first.getAttribute('data-position-known')}`
    if (now === prev) return now.endsWith('|true') ? now.split('|')[0]! : null
    prev = now
  }
}

test('en el safety car: chip de SC, «Estimado» si el estado de pista es deducido, y la vuelta del líder', async ({ page }) => {
  await open(page)
  const sc = await handle(page, (h) => h.markers.windows.find((w) => w.kind === 'sc') ?? null)
  expect(sc).not.toBeNull()
  const t = await hoverAt(page, sc!.fromMs + 60_000)
  expect(t).toBeLessThan(sc!.toMs)
  await expect(page.getByTestId('preview-neutral')).toHaveAttribute('data-kind', 'sc')
  // Mismo criterio que la cabecera: si su estado de pista es deducido, la tarjeta también lo marca.
  const inferred = await page.getByTestId('track-status').locator('[data-testid="estimated"][data-field="trackStatus"]').count()
  await expect(card(page).locator('[data-testid="estimated"][data-field="trackStatus"]')).toHaveCount(inferred)
  // Vuelta del líder, la misma que el dock (inicio de vuelta del primero que la empieza).
  const lap = await page.evaluate((x) => {
    const laps = window.__trazada!.markers.laps
    let lap = 0
    for (const l of laps) if (l.t <= x) lap = l.lap
    return lap
  }, t)
  expect(lap).toBeGreaterThan(0)
  await expect(page.getByTestId('preview-when')).toHaveText(new RegExp(`^(Vuelta|Lap) ${lap}(/\\d+)? · `))
})

test('«Líder» (nunca «Mejor vuelta» en carrera), el mismo que el primero de la clasificación en ese instante', async ({ page }) => {
  await open(page)
  const { startMs, endMs } = await handle(page, (h) => ({ startMs: h.startMs, endMs: h.endMs }))
  let compared = 0
  for (const f of [0.2, 0.45, 0.7, 0.95]) {
    await page.mouse.move(0, 0)
    const t = await hoverAt(page, startMs + f * (endMs - startMs))
    await expect(card(page)).toHaveAttribute('data-role', 'leader')
    await expect(page.getByTestId('preview-leader')).toContainText(/^(Líder|Leader)/)
    const leader = await card(page).getAttribute('data-leader')
    if (!leader) continue
    expect(leader, `t=${t}`).toBe(await leaderboardFirst(page, t))
    compared++
  }
  expect(compared).toBeGreaterThan(1)
})
