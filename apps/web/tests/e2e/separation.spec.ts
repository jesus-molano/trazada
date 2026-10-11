/**
 * «Separar coches» (D54) con el fixture (Spa 2026, libres 1): activada por defecto en un navegador nuevo, sin guardar
 * nada hasta que el usuario la cambia; al apagarla, se recuerda al recargar (y al volver a encenderla, también).
 */
import { expect, type Page, test } from '@playwright/test'
import { gotoApp } from './helpers'

const FP1 = '/replay?s=2026/10-spa-francorchamps/fp1'
const toggle = (page: Page) => page.getByTestId('toggle-separation')
const saved = (page: Page) =>
  page.evaluate(() => (JSON.parse(localStorage.getItem('trazada.settings') ?? '{}') as { separation?: boolean }).separation)

async function open(page: Page) {
  await expect.poll(async () => (await page.evaluate(() => window.__trazada?.scene.ready)) ?? false, { timeout: 15_000 }).toBe(true)
}

test('activada por defecto en un navegador nuevo; al cambiarla a mano, se recuerda', async ({ page }) => {
  // Contexto nuevo: almacenamiento vacío (sin resetStorage, que lo vaciaría también al recargar).
  await gotoApp(page, FP1)
  await open(page)
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true')
  expect(await saved(page)).toBeUndefined() // lo de por defecto no se guarda

  await toggle(page).click()
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false')
  expect(await saved(page)).toBe(false)
  await page.reload()
  await open(page)
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false')

  await toggle(page).click()
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true')
  await page.reload()
  await open(page)
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true')
  expect(await saved(page)).toBe(true)
})
