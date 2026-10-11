/**
 * Comandos de momentos en la paleta (ítem 14b, con los momentos del ítem 5, D35) con el fixture (Spa, libres 1): fuera
 * de carrera, «siguiente adelantamiento» y «siguiente duelo» salen deshabilitados con su motivo (solo en carrera y
 * sprint) y Enter no hace nada. Y el fallo visto en las capturas de la Tanda 4: «seguir VER» ya no sugiere
 * «Comparar con «seguir» — Sin dato: ningún piloto «seguir» en esta sesión».
 * Con una carrera de verdad (adelantamientos, duelos, «Sin spoilers»), `local-palette-moments.spec.ts`.
 */
import { expect, type Page, test } from '@playwright/test'
import { gotoApp } from './helpers'

const FP1 = '/replay?s=2026/10-spa-francorchamps/fp1'

/** Evalúa `fn(window.__trazada)` en la página (las funciones no viajan como argumento). */
const handle = <T>(page: Page, fn: (h: NonNullable<Window['__trazada']>) => T) =>
  page.evaluate(`(${fn.toString()})(window.__trazada)`) as Promise<T>

const palette = (page: Page) => page.getByTestId('command-palette')
const input = (page: Page) => page.getByTestId('palette-input')
const active = (page: Page) => page.locator('[data-testid="palette-option"][data-active="true"]')

async function openPalette(page: Page) {
  await gotoApp(page, FP1)
  await expect(page.getByTestId('replay-dock')).toBeVisible({ timeout: 15_000 })
  // Foco en la página sin tocar el lienzo (un clic ahí selecciona un coche).
  await page.getByTestId('replay-title').click()
  await page.keyboard.press('Control+k')
  await expect(palette(page)).toBeVisible()
  await expect(input(page)).toBeFocused()
}

test('libres: adelantamientos y duelos, deshabilitados con su motivo (solo en carrera y sprint)', async ({ page }) => {
  await openPalette(page)
  const t0 = await handle(page, (h) => h.timeMs)
  for (const [text, key] of [
    ['siguiente adelantamiento', 'moments.overtake.next'],
    ['next battle', 'moments.duel.next'],
    ['adelantamientos de VER', /^moments\.overtake\.next\.\d+$/],
  ] as const) {
    await input(page).fill(text)
    await expect(active(page)).toHaveAttribute('data-key', key)
    await expect(active(page)).toHaveAttribute('aria-disabled', 'true')
    await expect(active(page).getByTestId('palette-reason')).toContainText(/carrera y sprint|Races and sprints/)
    await page.keyboard.press('Enter')
    await expect(palette(page)).toBeVisible()
  }
  expect(await handle(page, (h) => h.timeMs)).toBe(t0)
  expect(await handle(page, (h) => h.selectedCar)).toBeNull()
})

test('«seguir VER» solo sugiere seguir a VER: nada de «Comparar con «seguir»»', async ({ page }) => {
  await openPalette(page)
  await input(page).fill('seguir VER')
  await expect(active(page)).toHaveAttribute('data-key', /^drivers\.follow\.\d+$/)
  await expect(page.locator('[data-testid="palette-option"][data-key^="compare."]')).toHaveCount(0)
  await expect(page.getByTestId('palette-list')).not.toContainText(/«seguir»|“seguir”/)
})
