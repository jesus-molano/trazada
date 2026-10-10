import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { gotoApp } from './helpers'

test('la portada carga con título y disclaimer', async ({ page }) => {
  await gotoApp(page, '/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByTestId('disclaimer')).toContainText('Formula One Licensing B.V.')
})

test('el disclaimer está en el footer de todas las páginas (también en el replay) y en el README', async ({ page }) => {
  await gotoApp(page, '/replay?s=2026/10-spa-francorchamps/fp1')
  const disclaimer = page.locator('footer[data-testid="disclaimer"]')
  await expect(disclaimer).toBeVisible()
  await expect(disclaimer).toContainText('Formula One Licensing B.V.')
  const readme = readFileSync(new URL('../../../../README.md', import.meta.url), 'utf8')
  expect(readme).toContain('Formula One Licensing B.V.')
})

test('el idioma se puede cambiar', async ({ page }) => {
  await gotoApp(page, '/')
  const heading = page.getByRole('heading', { level: 1 })
  const before = await heading.textContent()
  await page.getByTestId('lang-toggle').click()
  // Los mensajes del otro idioma se cargan bajo demanda: con la CPU compartida puede tardar.
  await expect(heading).not.toHaveText(before ?? '', { timeout: 15_000 })
})
