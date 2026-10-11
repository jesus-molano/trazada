/**
 * Momentos (ítem 5, D35) sobre el fixture (Spa 2026, libres 1): los botones del dock saltan 5 s antes del momento
 * siguiente o anterior (aquí, mensajes destacados de dirección de carrera: no hay adelantamientos ni duelos fuera de
 * carrera), también con la coma y el punto; en los bordes se deshabilitan. La pestaña «Momentos» de la hoja de
 * análisis explica que las listas solo existen en carrera y sprint, y elige entre qué clases saltan los botones. Sin
 * carril de adelantamientos en libres. Accesible (axe) en español y en inglés. Las listas con datos de carrera reales
 * solo se prueban en local (Japón, local-moments.spec.ts).
 */
import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { gotoApp, resetStorage } from './helpers'

const FP1 = '/replay?s=2026/10-spa-francorchamps/fp1'

interface MomentsStat {
  overtakes: number
  located: number
  duels: number
  duelsStatus: string
  moments: number
  kinds: string[]
  targets: { kind: string; t: number; seekMs: number }[]
}

async function openReplay(page: Page, baseURL?: string, lang: 'es' | 'en' = 'es') {
  await page.context().addCookies([{ name: 'trazada_lang', value: lang, url: baseURL ?? 'http://127.0.0.1' }])
  await resetStorage(page)
  await gotoApp(page, FP1)
  await expect.poll(async () => (await page.evaluate(() => window.__trazada?.scene.ready)) ?? false, { timeout: 15_000 }).toBe(true)
}

const stat = (page: Page) => page.evaluate(() => window.__trazada!.scene.moments as MomentsStat)
const time = (page: Page) => page.evaluate(() => window.__trazada!.timeMs)
const twoFrames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))

async function serious(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .exclude('[data-testid="scene"] canvas')
    .analyze()
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)
}

test('los botones del dock saltan 5 s antes de cada momento, también con la coma y el punto; en los bordes, deshabilitados', async ({ page }) => {
  await openReplay(page)
  const s = await stat(page)
  // En libres no hay adelantamientos ni duelos: solo neutralizaciones y mensajes destacados de dirección de carrera.
  expect(s.overtakes).toBe(0)
  expect(s.duels).toBe(0)
  expect(s.duelsStatus).toBe('notRace')
  expect(s.kinds).not.toContain('overtake')
  expect(s.targets.length).toBeGreaterThanOrEqual(2)
  const startMs = await page.evaluate(() => window.__trazada!.startMs)
  for (const m of s.targets) expect(m.seekMs).toBe(Math.max(startMs, m.t - 5000))

  const dock = page.getByTestId('replay-dock')
  const prev = dock.getByTestId('jump-prev')
  const next = dock.getByTestId('jump-next')
  await expect(next).toHaveAccessibleName(/Momento siguiente/)
  await expect(prev).toHaveAccessibleName(/Momento anterior/)
  await expect(prev).toBeDisabled()

  await next.click()
  await expect.poll(() => time(page)).toBe(s.targets[0]!.seekMs)

  // Teclado: el foco a la página con un clic en el título (nunca en el lienzo, que selecciona coches).
  await page.getByTestId('replay-title').click()
  await page.keyboard.press('.')
  await expect.poll(() => time(page)).toBe(s.targets[1]!.seekMs)
  await page.keyboard.press(',')
  await expect.poll(() => time(page)).toBe(s.targets[0]!.seekMs)

  // Al último: «siguiente» se deshabilita; «anterior» vuelve al de antes.
  const last = s.targets[s.targets.length - 1]!
  await page.evaluate((t) => window.__trazada!.seek(t), last.seekMs)
  await twoFrames(page)
  await expect(next).toBeDisabled()
  await expect(prev).toBeEnabled()
  await prev.click()
  await expect.poll(() => time(page)).toBe(s.targets[s.targets.length - 2]!.seekMs)
})

test('pestaña «Momentos» en libres: explica que las listas son de carrera y elige entre qué saltan los botones', async ({ page }) => {
  await openReplay(page)
  await page.getByTestId('analysis-button').click()
  await page.getByTestId('analysis-tab-moments').click()
  await expect(page.getByTestId('analysis-sheet')).toHaveAttribute('data-tab', 'moments')
  await expect(page.getByTestId('moments-only-race')).toContainText('carrera y sprint')
  await expect(page.getByTestId('overtake-row')).toHaveCount(0)

  const filter = page.getByTestId('moments-filter')
  await expect(filter.locator('[data-filter="all"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(filter.locator('[data-filter="overtake"]')).toBeDisabled()
  await expect(filter.locator('[data-filter="duel"]')).toBeDisabled()
  await filter.locator('[data-filter="raceControl"]').click()
  await expect(filter.locator('[data-filter="raceControl"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('jump-buttons')).toHaveAttribute('data-filter', 'raceControl')
  await expect(page.getByTestId('jump-next')).toHaveAccessibleName(/dirección de carrera/)

  // Con la hoja abierta, el dock sigue a mano: el salto mueve el reloj y la hoja sigue abierta.
  const s = await stat(page)
  const firstRc = s.targets.find((m) => m.kind === 'raceControl')!
  await page.getByTestId('jump-next').click()
  await expect.poll(() => time(page)).toBe(firstRc.seekMs)
  await expect(page.getByTestId('analysis-sheet')).toBeVisible()
})

test('sin carril de adelantamientos fuera de carrera', async ({ page }) => {
  await openReplay(page)
  await expect(page.getByTestId('timeline')).toBeVisible()
  await expect(page.getByTestId('overtake-lane')).toHaveCount(0)
})

for (const lang of ['es', 'en'] as const) {
  test(`accesible (axe) con la pestaña «Momentos» abierta y los botones del dock (${lang})`, async ({ page, baseURL }) => {
    await openReplay(page, baseURL, lang)
    expect(await serious(page)).toEqual([])
    await page.getByTestId('analysis-button').click()
    await page.getByTestId('analysis-tab-moments').click()
    await expect(page.getByTestId('analysis-sheet')).toHaveAttribute('data-tab', 'moments')
    expect(await serious(page)).toEqual([])
  })
}

test.describe('iPad horizontal 1024×768', () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true })

  test('los botones de saltos caben en el dock, sin scroll horizontal', async ({ page }) => {
    await openReplay(page)
    await expect(page.getByTestId('jump-prev')).toBeVisible()
    await expect(page.getByTestId('jump-next')).toBeVisible()
    const overflow = await page.evaluate(() => {
      const dock = document.querySelector('[data-testid="replay-dock"]')!
      return { page: document.documentElement.scrollWidth > document.documentElement.clientWidth, dock: dock.scrollWidth > dock.clientWidth }
    })
    expect(overflow).toEqual({ page: false, dock: false })
    // Un toque salta igual que un clic.
    await page.getByTestId('jump-next').tap()
    await expect.poll(() => time(page)).toBe((await stat(page)).targets[0]!.seekMs)
  })
})
