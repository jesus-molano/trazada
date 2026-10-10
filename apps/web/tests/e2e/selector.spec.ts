import { expect, test } from '@playwright/test'
import { gotoApp } from './helpers'

const FP1 = '2026/10-spa-francorchamps/fp1'

test.describe('selector de sesiones', () => {
  test('temporada → Gran Premio → sesión, con progreso hasta "listo"', async ({ page }) => {
    // Retrasa los ficheros de datos para que el progreso sea observable.
    await page.route('**/data/v1/sessions/**/*.gz', async (route) => {
      await new Promise((r) => setTimeout(r, 400))
      await route.continue()
    })
    await gotoApp(page, '/')
    await expect(page.getByTestId('season-2026')).toHaveAttribute('aria-pressed', 'true')
    await page.getByTestId('event-spa-francorchamps').click()
    await expect(page.getByTestId('session-fp1')).toBeVisible()
    await page.getByTestId('session-fp1').click()

    await expect(page).toHaveURL(new RegExp(`/replay\\?s=${FP1.replaceAll('/', '%2F')}|/replay\\?s=${FP1}`))
    await expect(page.getByTestId('load-progress')).toBeVisible()
    await expect(page.getByTestId('replay-status')).toHaveAttribute('data-state', 'ready', { timeout: 15_000 })
    await expect(page.getByTestId('replay-title')).toContainText('Belgian Grand Prix')
  })

  test('cada Gran Premio lleva la miniatura del trazado y la bandera del país', async ({ page, baseURL }) => {
    await page.context().addCookies([{ name: 'trazada_lang', value: 'es', url: baseURL! }])
    await gotoApp(page, '/')
    const card = page.getByTestId('event-spa-francorchamps')
    await expect(card.getByTestId('track-outline').locator('path')).toHaveAttribute('d', /^M[\d. ]+Z$/)
    await expect(card.getByTestId('flag')).toHaveAttribute('data-iso', 'BE')
    // Nombre del país en el idioma de la interfaz (Intl), no el texto en inglés del calendario.
    const meta = card.locator('.tz-event__meta')
    await expect(meta).toContainText('Bélgica')
    await expect(meta).not.toContainText('Belgium')
    // Sin peticiones externas: la bandera va incrustada.
    expect(await card.getByTestId('flag').getAttribute('src')).toMatch(/^data:image\/svg\+xml,/)
  })

  test('temporada sin datos → estado vacío', async ({ page }) => {
    await gotoApp(page, '/')
    await page.getByTestId('season-2025').click()
    await expect(page.getByTestId('season-empty')).toBeVisible()
    await expect(page).toHaveURL(/season=2025/)
  })

  test('sesión no-position: visible pero no disponible', async ({ page }) => {
    await gotoApp(page, '/?season=2026&event=10-spa-francorchamps')
    const fp2 = page.getByTestId('session-fp2')
    await expect(fp2).toBeVisible()
    await expect(fp2).toHaveAttribute('aria-disabled', 'true')
    await expect(fp2.locator('a')).toHaveCount(0)
  })

  test('el estado del selector sobrevive a la navegación atrás', async ({ page }) => {
    await gotoApp(page, '/')
    await page.getByTestId('event-spa-francorchamps').click()
    await page.getByTestId('session-fp1').click()
    await expect(page.getByTestId('replay-status')).toBeVisible({ timeout: 15_000 })
    await page.goBack()
    await expect(page.getByTestId('session-fp1')).toBeVisible()
  })
})
