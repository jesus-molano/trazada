/**
 * Qué es dato y qué es modelo (auditoría de honestidad, J y K): la explicación «Cómo se dibuja» y los avisos
 * de calidad del manifest, en el replay real, con teclado, por encima de los paneles y sin infracciones de axe.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect, type Locator, type Page, test } from '@playwright/test'
import { gotoApp } from './helpers'

const FP1 = '/replay?s=2026/10-spa-francorchamps/fp1'

async function open(page: Page) {
  await page.addInitScript(() => localStorage.clear())
  await gotoApp(page, FP1)
  await expect.poll(async () => (await page.evaluate(() => window.__trazada?.scene.ready)) ?? false, { timeout: 15_000 }).toBe(true)
}

/** El panel se ve encima de todo: en su centro, el elemento de arriba es el propio panel (o algo suyo). */
async function expectOnTop(panel: Locator) {
  const onTop = await panel.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return !!hit && el.contains(hit)
  })
  expect(onTop).toBe(true)
}

async function seriousAxe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .exclude('[data-testid="scene"] canvas')
    .analyze()
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)
}

test('avisos de calidad del manifest: se cuentan, se traducen y se leen con el teclado', async ({ page }) => {
  await open(page)
  const lang = await page.evaluate(() => document.documentElement.lang)
  const es = lang.startsWith('es')
  // El manifest del fixture trae cuatro avisos reales del procesado: cobertura de posición, fallos del feed
  // (coche 5), circuito sin curvas oficiales y extracto recortado para tests.
  const button = page.getByTestId('session-notes')
  await expect(button).toHaveText(es ? '4 avisos' : '4 notes')
  await expect(button).toHaveAccessibleName(es ? '4 avisos sobre los datos' : '4 notes on the data')
  await expect(button).toHaveAttribute('aria-expanded', 'false')
  await button.focus()
  await page.keyboard.press('Enter')
  await expect(button).toHaveAttribute('aria-expanded', 'true')
  const panel = page.getByTestId('session-notes-panel')
  await expect(panel).toBeVisible()
  await expect(panel.locator('li')).toHaveCount(4)
  await expect(panel.locator('li[data-code="no-corners"]')).toContainText(es ? 'no numera las curvas' : 'no corner numbers')
  // La cobertura, en %, con el formato del idioma (0,9787 → 97,9 %).
  await expect(panel.locator('li[data-code="position-coverage-low"]')).toContainText(es ? '97,9 %' : '97.9%')
  await expect(panel.locator('li[data-code="position-glitches"]')).toBeVisible()
  await expect(panel.locator('li[data-code="e2e-extract"]')).toBeVisible()
  await expect(panel.locator('li[data-code="unknown"]')).toHaveCount(0)
  await expectOnTop(panel)
  expect(await seriousAxe(page)).toEqual([])
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await expect(button).toBeFocused()
})

test('un aviso que la app no conoce se muestra con su texto original', async ({ page }) => {
  await page.route('**/sessions/2026/10-spa-francorchamps/fp1/manifest.json', async (route) => {
    const res = await route.fetch()
    const manifest = await res.json()
    manifest.quality.notes = ['meta desde el valor de reserva (5 m)']
    await route.fulfill({ response: res, json: manifest })
  })
  await open(page)
  await page.getByTestId('session-notes').click()
  const item = page.getByTestId('session-notes-panel').locator('li')
  await expect(item).toHaveAttribute('data-code', 'unknown')
  await expect(item.locator('[lang="es"]')).toHaveText('meta desde el valor de reserva (5 m)')
})

test('«Cómo se dibuja»: se abre con el teclado, va por encima de los paneles y Esc no saca del seguimiento', async ({ page }) => {
  // Sin animación de cámara: aquí solo importa a qué modo va, no la transición.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await open(page)
  const lang = await page.evaluate(() => document.documentElement.lang)
  const es = lang.startsWith('es')
  // Siguiendo a un coche (en un instante con el primero en pista): el Esc del panel lo cierra a él, no a la cámara.
  await page.evaluate(() => window.__trazada!.seek(window.__trazada!.startMs + 85_828))
  await page.locator('[data-testid="leaderboard"] [data-car]').first().getByRole('button').click()
  await page.getByTestId('follow-toggle').click()
  await expect.poll(() => page.evaluate(() => window.__trazada!.scene.cameraMode), { timeout: 5000 }).toBe('follow')

  const button = page.getByTestId('how-drawn')
  await expect(button).toHaveText(es ? 'Cómo se dibuja' : 'How it is drawn')
  await button.focus()
  await page.keyboard.press('Enter')
  const panel = page.getByTestId('how-drawn-panel')
  await expect(panel).toBeVisible()
  await expect(button).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('region', { name: es ? 'Cómo se dibuja' : 'How it is drawn' })).toBeVisible()
  await expect(panel).toContainText(es ? 'anchura genérica de 14 m' : 'generic 14 m width')
  await expect(panel).toContainText(es ? 'unas 4 veces por segundo' : 'about 4 times per second')
  await expectOnTop(panel)
  expect(await seriousAxe(page)).toEqual([])

  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await expect(button).toBeFocused()
  expect(await page.evaluate(() => window.__trazada!.scene.cameraMode)).toBe('follow')
  // Con el panel cerrado, Esc vuelve a la vista general como siempre.
  await page.keyboard.press('Escape')
  await expect.poll(() => page.evaluate(() => window.__trazada!.scene.cameraMode)).not.toBe('follow')
})

test('en tablet vertical, los dos paneles caben en la ventana', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 })
  await open(page)
  for (const id of ['session-notes', 'how-drawn']) {
    await page.getByTestId(id).click()
    const panel = page.getByTestId(`${id}-panel`)
    await expect(panel).toBeVisible()
    const box = (await panel.boundingBox())!
    expect(box.x, id).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width, id).toBeLessThanOrEqual(768)
    await expectOnTop(panel)
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
  }
})

test('en una ventana baja, el panel que no cabe se enfoca y se desplaza con el teclado', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 560 })
  await open(page)
  const button = page.getByTestId('how-drawn')
  await button.focus()
  await page.keyboard.press('Enter')
  const panel = page.getByTestId('how-drawn-panel')
  await expect(panel).toBeVisible()
  // Condición del caso: el texto no cabe en la altura máxima del panel.
  const { scroll, client } = await panel.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }))
  expect(scroll).toBeGreaterThan(client)
  await page.keyboard.press('Tab')
  await expect(panel).toBeFocused()
  await page.keyboard.press('End')
  await expect.poll(() => panel.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  expect(await seriousAxe(page)).toEqual([])
  // Esc con el foco en el panel: se cierra y el foco vuelve al botón.
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await expect(button).toBeFocused()
})

test('en inglés, la explicación y los avisos también se traducen', async ({ page }) => {
  await open(page)
  const lang = await page.evaluate(() => document.documentElement.lang)
  if (lang.startsWith('es')) {
    await page.getByRole('button', { name: /English|inglés/i }).click()
    await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toMatch(/^en/)
  }
  await page.getByTestId('how-drawn').click()
  await expect(page.getByTestId('how-drawn-panel')).toContainText('What is data and what is model')
  await page.getByTestId('session-notes').click()
  await expect(page.getByTestId('how-drawn-panel')).toBeHidden()
  await expect(page.getByTestId('session-notes-panel')).toContainText('Trimmed extract of the session')
})
