import { expect, type Page, test } from '@playwright/test'
import { gotoApp } from './helpers'

const FP1 = '/replay?s=2026/10-spa-francorchamps/fp1'

const handle = <T>(page: Page, fn: (h: NonNullable<Window['__trazada']>) => T) =>
  page.evaluate(`(${fn.toString()})(window.__trazada)`) as Promise<T>

async function open(page: Page) {
  await gotoApp(page, FP1)
  await expect(page.getByTestId('race-control')).toBeVisible({ timeout: 15_000 })
}

async function seek(page: Page, ms: number) {
  await page.evaluate((t) => window.__trazada!.seek(t), ms)
}

test('feed: tras 20 seeks aleatorios, los mensajes visibles son exactamente los de t ≤ reloj', async ({ page }) => {
  await open(page)
  const { startMs, endMs, times } = await handle(page, (h) => ({ startMs: h.startMs, endMs: h.endMs, times: h.raceControlTimes }))
  expect(times.length).toBeGreaterThan(5)
  // Pseudoaleatorio con semilla fija (reproducible), más los bordes exactos de algunos mensajes.
  let seed = 20261010
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
  const targets = Array.from({ length: 17 }, () => Math.round(startMs + rand() * (endMs - startMs)))
  targets.push(times[3]!, times[3]! - 1, times[times.length - 1]!)
  const items = page.getByTestId('rc-message')
  for (const t of targets) {
    await seek(page, t)
    const clock = await handle(page, (h) => h.timeMs)
    const expected = times.filter((x) => x <= clock).reverse()
    await expect
      .poll(() => items.evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-t')))))
      .toEqual(expected)
  }
})

test('texto original tal cual y tipo traducido', async ({ page }) => {
  await open(page)
  const { endMs } = await handle(page, (h) => ({ endMs: h.endMs }))
  await seek(page, endMs)
  const yellow = page.locator('[data-testid="rc-message"][data-kind="sector_double_yellow"]').last()
  await expect(yellow.getByTestId('rc-text')).toHaveText('DOUBLE YELLOW IN TRACK SECTOR 7')
  await expect(yellow.getByTestId('rc-text')).toHaveAttribute('lang', 'en')
  const lang = await page.evaluate(() => document.documentElement.lang)
  await expect(yellow.getByTestId('rc-kind')).toHaveText(lang.startsWith('es') ? 'Doble amarilla' : 'Double yellow')
  // Se puede plegar
  await page.getByTestId('race-control-toggle').click()
  await expect(page.getByTestId('race-control-toggle')).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByTestId('rc-message').first()).toBeHidden()
})

/*
 * Microinteracciones (21b, D42): un mensaje que llega con reproducción a ×1 entra con su transición y destella una vez
 * (`data-fresh`, que se va solo); tras un seek, la lista cambia al instante (ningún elemento `*-enter-active`).
 */
test('tras un seek la lista cambia al instante: ningún mensaje entra con transición ni destella', async ({ page }) => {
  await open(page)
  const { startMs, endMs, times } = await handle(page, (h) => ({ startMs: h.startMs, endMs: h.endMs, times: h.raceControlTimes }))
  for (const t of [times[3]! + 10, endMs, startMs, times[times.length - 1]! + 10]) {
    await seek(page, t)
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)))
    const moving = await page.evaluate(() => ({
      entering: document.querySelectorAll('[data-testid="race-control"] [class*="-enter-active"]').length,
      fresh: document.querySelectorAll('[data-testid="rc-message"][data-fresh]').length,
    }))
    expect(moving).toEqual({ entering: 0, fresh: 0 })
  }
})

test('a ×1, el mensaje que llega destella una vez (data-fresh) y luego deja de hacerlo', async ({ page }) => {
  await open(page)
  const times = await handle(page, (h) => h.raceControlTimes)
  // Un mensaje sin otro en los 2 s anteriores: se llega reproduciendo desde 1,5 s antes.
  const target = times.find((t, i) => i > 0 && t - times[i - 1]! > 2_000)!
  await seek(page, target - 1_500)
  await page.getByTestId('rate-1').click()
  await page.getByTestId('replay-title').click()
  await page.keyboard.press(' ')
  const msg = page.locator(`[data-testid="rc-message"][data-t="${target}"]`)
  await expect(msg).toHaveAttribute('data-fresh', '', { timeout: 10_000 })
  await expect(msg).not.toHaveAttribute('data-fresh', { timeout: 5_000 })
  await page.keyboard.press(' ')
})

test('banderas por sector en trackState: 1 s después del mensaje y 1 s después del CLEAR', async ({ page }) => {
  await open(page)
  const rc = await page.evaluate(async () => {
    // Los mensajes vienen del propio feed (DOM): t y texto.
    const h = window.__trazada!
    h.seek(h.endMs)
    await new Promise((r) => setTimeout(r, 300))
    return [...document.querySelectorAll('[data-testid="rc-message"]')].map((e) => ({
      t: Number(e.getAttribute('data-t')),
      text: e.querySelector('[data-testid="rc-text"]')!.textContent,
    }))
  })
  const on = rc.filter((m) => m.text === 'DOUBLE YELLOW IN TRACK SECTOR 7').sort((a, b) => a.t - b.t)[0]!
  const clear = rc.filter((m) => m.text === 'CLEAR IN TRACK SECTOR 7' && m.t > on.t).sort((a, b) => a.t - b.t)[0]!

  await seek(page, on.t + 1000)
  await expect.poll(() => handle(page, (h) => h.trackState.sectors[7])).toBe('DOUBLE YELLOW')
  const chip = page.locator('[data-testid="track-sector"][data-sector="7"]')
  await expect(chip).toHaveAttribute('data-flag', 'DOUBLE YELLOW')
  await expect(chip).toContainText('7')
  // Spa (fixture, sin MultiViewer) no tiene geometría de sectores: no hay capa en el mapa y el chip lo explica.
  expect(await handle(page, (h) => h.scene.marshalSectors)).toBe(0)
  await expect(chip).toHaveAttribute('title', /.+/)

  await seek(page, clear.t + 1000)
  await expect.poll(() => handle(page, (h) => h.trackState.sectors[7] ?? null)).toBe(null)
  await expect(chip).toHaveCount(0)
})
