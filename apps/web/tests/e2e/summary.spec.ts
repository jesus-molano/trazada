/**
 * Tarjeta de fin de sesión (ítem 12, D40) sobre el fixture (Spa 2026, libres 1: el estado «Finished» cae dentro de la
 * reproducción). Se abre sola al cruzar el fin reproduciendo, con los mismos tres primeros que la clasificación en ese
 * instante; Esc la cierra; el botón del dock la reabre; volver atrás la quita; un salto no la abre. Lo que falte en el
 * extracto dice «sin dato». Con movimiento reducido, sin animación. Accesible (axe) en español y en inglés.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { gotoApp, resetStorage, settled } from './helpers'

const FP1 = '/replay?s=2026/10-spa-francorchamps/fp1'

interface SummaryStat {
  showMs: number
  endMs: number
  source: 'finished' | 'chequered' | 'data-end'
  available: boolean
  open: boolean
}

async function openReplay(page: Page, baseURL: string | undefined, lang: 'es' | 'en' = 'es') {
  await page.context().addCookies([{ name: 'trazada_lang', value: lang, url: baseURL ?? 'http://127.0.0.1' }])
  await resetStorage(page)
  await gotoApp(page, FP1)
  await expect.poll(async () => (await page.evaluate(() => window.__trazada?.scene.ready)) ?? false, { timeout: 15_000 }).toBe(true)
}

const stat = (page: Page) => page.evaluate(() => window.__trazada!.scene.summary as SummaryStat)

/** Seek con precisión de ms y dos frames para que la interfaz lo refleje. */
async function seek(page: Page, ms: number) {
  await page.evaluate((t) => window.__trazada!.seek(t), ms)
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
}

const card = (page: Page) => page.getByTestId('session-summary')
const button = (page: Page) => page.getByTestId('summary-button')

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

test('se abre sola al cruzar el fin reproduciendo, con los tres primeros de la clasificación; Esc, botón y volver atrás', async ({ page, baseURL }) => {
  await openReplay(page, baseURL)
  const s = await stat(page)
  expect(s.source).toBe('finished')
  const { startMs, endMs } = await page.evaluate(() => ({ startMs: window.__trazada!.startMs, endMs: window.__trazada!.endMs }))
  expect(s.showMs).toBeGreaterThanOrEqual(s.endMs)
  expect(s.showMs).toBeGreaterThan(startMs)
  expect(s.showMs).toBeLessThan(endMs)

  // Antes del fin no hay resumen.
  await seek(page, s.showMs - 2_000)
  await expect(button(page)).toHaveCount(0)
  await expect(card(page)).toHaveCount(0)

  await page.getByTestId('rate-4').click()
  await page.getByTestId('play-toggle').click()
  await expect(card(page)).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('summary-close')).toBeFocused()
  await expect(card(page)).toHaveAttribute('role', 'dialog')
  await expect(card(page)).toHaveAttribute('aria-modal', 'true')
  await expect(page.getByTestId('summary-basis')).toContainText('sanciones posteriores')

  // Los mismos tres primeros que la clasificación en ese instante.
  const summaryCars = await card(page).getByTestId('summary-row').evaluateAll((els) => els.map((e) => e.getAttribute('data-car')))
  const boardCars = await page
    .locator('[data-testid="leaderboard"] [data-car]')
    .evaluateAll((els) => els.slice(0, 3).map((e) => e.getAttribute('data-car')))
  expect(summaryCars).toEqual(boardCars)
  expect(summaryCars).toHaveLength(3)

  // Esc (primera prioridad) la cierra; el reloj sigue.
  await page.keyboard.press('Escape')
  await expect(card(page)).toHaveCount(0)
  await page.getByTestId('play-toggle').click()
  await expect.poll(() => page.evaluate(() => window.__trazada!.playing)).toBe(false)

  // El botón del dock la reabre.
  await expect(button(page)).toBeVisible()
  await button(page).click()
  await expect(card(page)).toBeVisible()
  await expect(button(page)).toHaveAttribute('aria-expanded', 'true')

  // Volver atrás (antes del fin): se cierra y el botón desaparece.
  await seek(page, s.showMs - 30_000)
  await expect(card(page)).toHaveCount(0)
  await expect(button(page)).toHaveCount(0)
})

test('un salto por encima del fin no la abre; al final de los datos, cada hueco con dato o «sin dato»', async ({ page, baseURL }) => {
  await openReplay(page, baseURL)
  const endMs = await page.evaluate(() => window.__trazada!.endMs)
  await seek(page, endMs)
  await expect(button(page)).toBeVisible()
  await page.waitForTimeout(300)
  await expect(card(page)).toHaveCount(0)

  await button(page).click()
  await expect(card(page)).toBeVisible()
  // Libres: los tres primeros por mejor vuelta, con su tiempo (o «sin dato»), gap y vueltas.
  await expect(card(page)).toHaveAttribute('data-race', 'false')
  const rows = card(page).getByTestId('summary-row')
  await expect(rows).toHaveCount(3)
  for (const value of await rows.getByTestId('summary-value').allTextContents()) {
    expect(value.trim()).toMatch(/^(\d+:\d{2},\d{3}|sin dato)$/)
  }
  for (const laps of await rows.getByTestId('summary-laps').allTextContents()) {
    expect(laps.trim()).toMatch(/^(\d+ vueltas?|Vueltas: sin dato)$/)
  }
  // Nunca un hueco vacío: un puesto sin coche con posición dice «sin dato».
  for (const empty of await rows.locator('[data-empty="true"]').allTextContents()) expect(empty).toContain('sin dato')
  const fastest = page.getByTestId('summary-fastest')
  await expect(fastest).toContainText(/(\d+:\d{2},\d{3}|sin dato)/)
  // De dónde sale el fin: si los datos no lo traen, la tarjeta lo dice.
  const s = await stat(page)
  if (s.source === 'data-end') await expect(page.getByTestId('summary-basis')).toContainText('final de los datos')
  else await expect(page.getByTestId('summary-basis')).toContainText('al terminar la sesión')

  // Un clic fuera de la tarjeta la cierra.
  await page.mouse.click(5, 5)
  await expect(card(page)).toHaveCount(0)
})

test('entrada suave con los tokens; con movimiento reducido, sin animación', async ({ page, baseURL }) => {
  await openReplay(page, baseURL)
  const endMs = await page.evaluate(() => window.__trazada!.endMs)
  await seek(page, endMs)
  await button(page).click()
  const animation = () =>
    card(page).evaluate((el) => [...el.querySelectorAll('.tz-summary__step')].map((e) => getComputedStyle(e).animationName))
  expect(new Set(await animation())).toEqual(new Set(['tz-enter']))
  await page.keyboard.press('Escape')
  await expect(card(page)).toHaveCount(0)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await button(page).click()
  await expect(card(page)).toBeVisible()
  expect(new Set(await animation())).toEqual(new Set(['none']))
  expect(await card(page).evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0)
})

for (const lang of ['es', 'en'] as const) {
  test(`accesible con la tarjeta abierta (${lang})`, async ({ page, baseURL }) => {
    await openReplay(page, baseURL, lang)
    const endMs = await page.evaluate(() => window.__trazada!.endMs)
    await seek(page, endMs)
    await button(page).click()
    await expect(card(page)).toBeVisible()
    await expect(page.getByTestId('summary-close')).toBeFocused()
    // Tras la entrada (las animaciones bajan el contraste mientras duran).
    await page.waitForTimeout(800)
    expect(await serious(page)).toEqual([])
  })
}
