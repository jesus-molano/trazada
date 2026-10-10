/**
 * Reanudar donde lo dejaste (ítem 13, D41): el replay guarda el instante, el coche, el seguimiento y la velocidad en
 * `trazada.resume` y los retoma al volver (en pausa, con el aviso «Retomado en …»); «Empezar desde el principio»,
 * `?t=` manda, el bench lo ignora, casi al final cuenta como vista, un coche que ya no está se ignora, y la tarjeta
 * «Seguir viendo» de la portada (solo con sesiones del catálogo).
 *
 * Ojo: aquí no vale `resetStorage` ni `addInitScript(() => localStorage.clear())`, que se ejecutan también en cada
 * recarga y borrarían justo lo que se prueba. Cada test empieza con su contexto (almacenamiento vacío) y siembra lo
 * guardado solo si no hay nada (`seed`).
 */
import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { gotoApp } from './helpers'

const FP1_ID = '2026/10-spa-francorchamps/fp1'
const FP1 = `/replay?s=${FP1_ID}`
const KEY = 'trazada.resume'
/** Instante en el que el coche 1 rueda por la pista (lo usan también las capturas del README). */
const AT_MS = 85_828

interface ManifestSession {
  event: string
  t0Utc: string
  playback: { startMs: number; endMs: number }
}

/** Datos de la sesión del fixture, del manifest que sirve el propio servidor de los e2e. */
async function fp1Session(page: Page): Promise<ManifestSession> {
  const res = await page.request.get(`/data/v1/sessions/${FP1_ID}/manifest.json`)
  expect(res.ok()).toBe(true)
  return ((await res.json()) as { session: ManifestSession }).session
}

/** Una entrada como las que guarda el replay (formato v1). */
function entry(s: ManifestSession, over: Record<string, unknown> = {}) {
  return {
    id: FP1_ID,
    t: s.playback.startMs + 200_000,
    car: null,
    follow: false,
    rate: 1,
    savedAt: Date.now() - 2 * 3_600_000,
    t0Utc: s.t0Utc,
    startMs: s.playback.startMs,
    endMs: s.playback.endMs,
    event: s.event,
    lap: null,
    totalLaps: null,
    clockMs: 200_000,
    ...over,
  }
}

/** Siembra lo guardado antes de la primera carga (y solo si no hay nada: las recargas ven lo que haya quedado). */
async function seed(page: Page, sessions: object[]) {
  await page.addInitScript(
    ([key, value]) => {
      if (localStorage.getItem(key!) === null) localStorage.setItem(key!, value!)
    },
    [KEY, JSON.stringify({ sessions, _v: 1 })],
  )
}

/** Lo guardado (la lista de sesiones), o null si no hay nada. */
const stored = (page: Page) =>
  page.evaluate((key) => (JSON.parse(localStorage.getItem(key) ?? 'null') as { sessions: Record<string, unknown>[] } | null)?.sessions ?? null, KEY)

async function waitReady(page: Page) {
  await expect.poll(async () => (await page.evaluate(() => window.__trazada?.scene.ready)) ?? false, { timeout: 15_000 }).toBe(true)
}

async function open(page: Page, path = FP1) {
  await gotoApp(page, path)
  await waitReady(page)
}

const state = (page: Page) =>
  page.evaluate(() => {
    const h = window.__trazada!
    return { t: h.timeMs, playing: h.playing, rate: h.rate, car: h.selectedCar, startMs: h.startMs, endMs: h.endMs }
  })

async function serious(page: Page, include: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).include(include).analyze()
  return results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)
}

test('guarda instante, coche, seguimiento y velocidad; al recargar los retoma en pausa, con el aviso', async ({ page }) => {
  await open(page)
  const { startMs } = await state(page)
  const at = startMs + AT_MS
  await page.evaluate((t) => window.__trazada!.seek(t), at)
  await page.locator('[data-testid="leaderboard"] [data-car="1"]').getByRole('button').click()
  await page.getByTestId('follow-toggle').click()
  await expect.poll(() => page.evaluate(() => window.__trazada!.scene.cameraMode), { timeout: 5000 }).toBe('follow')
  await page.getByTestId('rate-4').click()
  // Se guarda 1 s después del último cambio, sin esperar a salir de la página.
  await expect
    .poll(() => stored(page), { timeout: 5000 })
    .toEqual([expect.objectContaining({ id: FP1_ID, t: at, car: '1', follow: true, rate: 4 })])

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true')
  await waitReady(page)
  const s = await state(page)
  expect(Math.abs(s.t - at)).toBeLessThanOrEqual(1000)
  expect(s.playing).toBe(false)
  expect(s.rate).toBe(4)
  expect(s.car).toBe('1')
  await expect(page.getByTestId('rate-4')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('telemetry')).toHaveAttribute('data-car', '1')
  await expect.poll(() => page.evaluate(() => window.__trazada!.scene.cameraMode), { timeout: 5000 }).toBe('follow')

  // El aviso, sobre el dock, con el mismo reloj que el dock.
  const toast = page.getByTestId('resume-toast')
  await expect(toast).toBeVisible()
  await expect(page.getByTestId('replay-dock').getByTestId('resume-toast')).toBeVisible()
  const clock = (await page.locator('[data-testid="time-readout"] .tz-readout__clock').textContent())!.trim()
  await expect(page.getByTestId('resume-at')).toHaveText(new RegExp(`(Retomado en|Resumed at) ${clock}$`))
  expect(await serious(page, '[data-testid="resume-toast"]')).toEqual([])
})

test('«Empezar desde el principio»: instante por defecto, sin coche y a ×1; lo guardado se olvida', async ({ page }) => {
  const s = await fp1Session(page)
  await seed(page, [entry(s, { car: '1', rate: 8 })])
  await open(page)
  expect(await state(page)).toMatchObject({ t: s.playback.startMs + 200_000, car: '1', rate: 8, playing: false })
  await page.getByTestId('resume-restart').click()
  await expect(page.getByTestId('resume-toast')).toBeHidden()
  expect(await state(page)).toMatchObject({ t: s.playback.startMs, car: null, rate: 1 })
  await expect.poll(() => stored(page)).toEqual([])

  await page.reload()
  await waitReady(page)
  expect((await state(page)).t).toBe(s.playback.startMs)
  await expect(page.getByTestId('resume-toast')).toHaveCount(0)
})

test('?t= manda sobre lo guardado (sin aviso)', async ({ page }) => {
  const s = await fp1Session(page)
  await seed(page, [entry(s, { car: '1' })])
  await open(page, `${FP1}&t=${s.playback.startMs + 300_000}`)
  expect(await state(page)).toMatchObject({ t: s.playback.startMs + 300_000, car: null })
  await expect(page.getByTestId('resume-toast')).toHaveCount(0)
})

test('el bench (?bench=1) ni retoma ni guarda', async ({ page }) => {
  const s = await fp1Session(page)
  const seeded = [entry(s, { car: '1' })]
  await seed(page, seeded)
  await gotoApp(page, `${FP1}&bench=1&benchWarmup=1&benchSeconds=1`)
  await expect(page.getByTestId('bench')).toHaveAttribute('data-status', 'done', { timeout: 20_000 })
  await expect(page.getByTestId('resume-toast')).toHaveCount(0)
  expect(await stored(page)).toEqual(seeded)
})

test('a menos de 30 s del final la sesión cuenta como vista: se olvida y la próxima vez empieza como siempre', async ({ page }) => {
  await open(page)
  const { startMs, endMs } = await state(page)
  await page.evaluate((t) => window.__trazada!.seek(t), startMs + 200_000)
  await expect.poll(() => stored(page)).toEqual([expect.objectContaining({ id: FP1_ID, t: startMs + 200_000 })])
  await page.evaluate((t) => window.__trazada!.seek(t), endMs - 10_000)
  await expect.poll(() => stored(page)).toEqual([])
  await page.reload()
  await waitReady(page)
  expect((await state(page)).t).toBe(startMs)
  await expect(page.getByTestId('resume-toast')).toHaveCount(0)
})

test('un coche que ya no está en la sesión se ignora; el instante se retoma igual', async ({ page }) => {
  const s = await fp1Session(page)
  await seed(page, [entry(s, { car: '999', follow: true })])
  await open(page)
  expect(await state(page)).toMatchObject({ t: s.playback.startMs + 200_000, car: null })
  await expect(page.getByTestId('telemetry')).toHaveCount(0)
  await expect(page.getByTestId('resume-toast')).toBeVisible()
})

test('portada: «Seguir viendo» solo con sesiones del catálogo; lleva a la sesión y × la olvida', async ({ page }) => {
  const s = await fp1Session(page)
  const now = Date.now()
  await seed(page, [
    entry(s, { savedAt: now - 3 * 60_000 }),
    entry(s, { id: '2026/11-nowhere/race', savedAt: now - 2 * 60_000 }), // ya no está en el catálogo
    entry(s, { id: '2026/10-spa-francorchamps/fp2', savedAt: now - 60_000 }), // sin posiciones
  ])
  await gotoApp(page, '/')
  const card = page.getByTestId('continue')
  await expect(card).toBeVisible()
  await expect(card.locator('[data-session]')).toHaveCount(1)
  const item = card.locator(`[data-session="${FP1_ID}"]`)
  await expect(item).toContainText(s.event)
  await expect(item.getByTestId('continue-where')).toContainText('3:20')
  expect(await serious(page, '[data-testid="continue"]')).toEqual([])

  await item.getByTestId('continue-link').click()
  await expect(page).toHaveURL(/\/replay\?s=2026\/10-spa-francorchamps\/fp1$/)
  await waitReady(page)
  expect((await state(page)).t).toBe(s.playback.startMs + 200_000)
  await expect(page.getByTestId('resume-toast')).toBeVisible()

  await page.goBack()
  await expect(card.locator(`[data-session="${FP1_ID}"]`)).toBeVisible()
  await card.locator(`[data-session="${FP1_ID}"]`).getByTestId('continue-forget').click()
  await expect(card).toHaveCount(0)
  const left = await stored(page)
  expect(left?.map((e) => e.id)).not.toContain(FP1_ID)
  // El selector sigue debajo, como siempre.
  await expect(page.getByTestId('event-spa-francorchamps')).toBeVisible()
})
