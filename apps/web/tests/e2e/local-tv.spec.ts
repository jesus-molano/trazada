/**
 * Realización automática (ítem 9, D39) con la carrera de Japón 2026 de data/ (datos completos; fuente dev, nunca en un
 * fixture: sin torre de tiempos). Bajo coche de seguridad sigue al líder de la clasificación (nunca un duelo); con
 * bandera verde, duelos por cercanía en pista entre coches de la misma vuelta, y el chip nunca da una cifra. Solo en
 * local, con un servidor aparte:
 *   E2E_DATA_DIR=../../data node tests/e2e/serve.mjs --port 4199
 *   E2E_LOCAL_URL=http://127.0.0.1:4199 pnpm e2e local-tv
 */
import { expect, type Page, test } from '@playwright/test'
import { markTipsSeen } from './helpers'

const BASE = process.env.E2E_LOCAL_URL
test.skip(!BASE, 'solo en local (E2E_LOCAL_URL con data/ servido)')

interface TvStats {
  active: boolean
  shot: { id: number; kind: 'duel' | 'leader' | 'overview'; cars: string[]; basis: 'tower' | 'proximity' | null; reason: string } | null
  intervalMs: number | null
}

const handle = <T>(page: Page, fn: (h: NonNullable<Window['__trazada']>) => T) =>
  page.evaluate(`(${fn.toString()})(window.__trazada)`) as Promise<T>
const tv = (page: Page) => page.evaluate(() => window.__trazada!.scene.tv as TvStats)

async function open(page: Page) {
  await markTipsSeen(page)
  await page.goto(`${BASE}/replay?s=2026/03-suzuka/race`)
  await page.waitForFunction(() => window.__trazada?.scene.ready, null, { timeout: 30_000 })
}

/** Primero de la clasificación (posición conocida), tras asentarse (se publica cada 150 ms). */
async function leaderboardFirst(page: Page): Promise<string | null> {
  const first = page.locator('[data-testid="leaderboard"] [data-car]').first()
  let prev = ''
  for (;;) {
    await page.waitForTimeout(400)
    const now = `${await first.getAttribute('data-car')}|${await first.getAttribute('data-position-known')}`
    if (now === prev) return now.endsWith('|true') ? now.split('|')[0]! : null
    prev = now
  }
}

/** Seek a t con la realización encendida y espera al plano nuevo (tras un seek, elige de cero al momento). */
async function seekShot(page: Page, t: number): Promise<TvStats> {
  const before = (await tv(page)).shot?.id ?? 0
  await page.evaluate((x) => window.__trazada!.seek(x), t)
  await expect.poll(async () => (await tv(page)).shot?.id ?? 0).toBeGreaterThan(before)
  return tv(page)
}

async function start(page: Page) {
  await page.getByTestId('replay-title').click()
  await page.keyboard.press('t')
  await expect.poll(() => handle(page, (h) => h.scene.cameraMode), { timeout: 5000 }).toBe('tv')
}

test('bajo coche de seguridad, el líder de la clasificación (nunca un duelo), con el estado de pista en el chip', async ({ page }) => {
  await open(page)
  const sc = await handle(page, (h) => h.markers.windows.find((w) => w.kind === 'sc') ?? null)
  expect(sc).not.toBeNull()
  await start(page)
  const leaders: string[] = []
  for (const offset of [20_000, 45_000, 70_000, 95_000]) {
    const t = sc!.fromMs + offset
    if (t > sc!.toMs - 3000) break
    const s = await seekShot(page, t)
    await expect.poll(() => handle(page, (h) => h.trackState.neutral)).toBe('sc')
    expect(s.shot!.kind).not.toBe('duel')
    expect(s.shot!.reason).toBe('neutral')
    expect(s.intervalMs).toBeNull()
    if (s.shot!.kind !== 'leader') continue
    // El líder es el de la clasificación (pasos por meta), nunca el que va primero en pista.
    expect(s.shot!.cars).toEqual([await leaderboardFirst(page)])
    const text = page.getByTestId('tv-chip-text')
    await expect(text).toHaveText(/(Coche de seguridad|Safety car)/)
    expect(await text.textContent()).not.toMatch(/\d/)
    leaders.push(s.shot!.cars[0]!)
  }
  expect(leaders.length).toBeGreaterThan(0)
})

test('sin torre: duelos por cercanía entre coches de la misma vuelta, sin cifra, dentro del presupuesto de la escena', async ({ page }) => {
  await open(page)
  await start(page)
  const laps = await handle(page, (h) => h.markers.laps)
  const neutral = await handle(page, (h) => h.markers.windows.filter((w) => ['sc', 'vsc', 'red'].includes(w.kind)))
  let duels = 0
  for (const lap of [5, 12, 20, 30, 40]) {
    const start = laps.find((l) => l.lap === lap)?.t
    if (start === undefined) continue
    // Medio minuto después de empezar la vuelta, lejos de cualquier neutralización.
    const t = start + 30_000
    if (neutral.some((w) => t >= w.fromMs - 5000 && t <= w.toMs + 5000)) continue
    const s = await seekShot(page, t)
    expect(s.shot!.basis).not.toBe('tower')
    expect(s.intervalMs).toBeNull()
    expect(await page.getByTestId('tv-chip-text').textContent()).not.toMatch(/\d/)
    if (s.shot!.kind !== 'duel') continue
    duels++
    expect(s.shot!.basis).toBe('proximity')
    const cars = await page.evaluate(() => window.__trazada!.cars())
    const [a, b] = s.shot!.cars.map((c) => cars.find((x) => x.car === c)!)
    // s acumulada: misma vuelta (un doblado queda a una vuelta o más).
    expect(Math.abs(a!.s - b!.s)).toBeLessThan(200)
    const st = await page.evaluate(() => ({ ...window.__trazada!.scene }))
    expect(st.drawCalls).toBeLessThan(30)
    expect(st.triangles).toBeLessThan(150_000)
  }
  expect(duels).toBeGreaterThan(0)
})
