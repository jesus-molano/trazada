/**
 * Build vieja (pendiente 6 del PLAN): si falta un trozo de JS de la build de antes (Vite no puede precargarlo, o un
 * import dinámico falla), un aviso no modal ofrece recargar en vez de un error; se puede cerrar y recargar lo quita.
 */
import { expect, test } from '@playwright/test'
import { gotoApp } from './helpers'

test('un trozo que ya no existe: aviso con «Recargar», que recarga la página', async ({ page }) => {
  await gotoApp(page, '/')
  await expect(page.getByTestId('stale-build')).toHaveCount(0)
  await page.evaluate(() => window.dispatchEvent(new Event('vite:preloadError', { cancelable: true })))
  const notice = page.getByTestId('stale-build')
  await expect(notice).toBeVisible()
  await expect(notice).toHaveAttribute('role', 'status')
  await page.getByTestId('stale-build-reload').click()
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true')
  await expect(page.getByTestId('stale-build')).toHaveCount(0)
})

test('un import dinámico que falla también avisa; el aviso se cierra', async ({ page }) => {
  await gotoApp(page, '/')
  await page.evaluate(() => {
    void Promise.reject(new TypeError('Failed to fetch dynamically imported module: http://127.0.0.1/_nuxt/viejo.js'))
  })
  await expect(page.getByTestId('stale-build')).toBeVisible()
  await page.getByTestId('stale-build-close').click()
  await expect(page.getByTestId('stale-build')).toHaveCount(0)
})
