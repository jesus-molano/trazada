import { expect, test } from '@playwright/test'
import { gotoApp } from './helpers'

test('la portada carga con título y disclaimer', async ({ page }) => {
  await gotoApp(page, '/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByTestId('disclaimer')).toContainText('Formula One Licensing B.V.')
})

test('el idioma se puede cambiar', async ({ page }) => {
  await gotoApp(page, '/')
  const heading = page.getByRole('heading', { level: 1 })
  const before = await heading.textContent()
  await page.getByTestId('lang-toggle').click()
  // Los mensajes del otro idioma se cargan bajo demanda: con la CPU compartida puede tardar.
  await expect(heading).not.toHaveText(before ?? '', { timeout: 15_000 })
})
