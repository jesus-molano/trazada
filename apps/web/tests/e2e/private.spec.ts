/**
 * Despliegue privado (D24): sin contraseña no se ve nada; con ella, el deep link se carga y se pinta.
 * Solo con E2E_PRIVATE_URL y E2E_PRIVATE_PASSWORD (la Worker real, o `wrangler dev` en local).
 */
import { expect, test } from '@playwright/test'

const BASE = process.env.E2E_PRIVATE_URL?.replace(/\/$/, '')
const PASSWORD = process.env.E2E_PRIVATE_PASSWORD
const SESSION = process.env.E2E_PRIVATE_SESSION ?? '2026/10-spa-francorchamps/fp1'
test.skip(!BASE || !PASSWORD, 'solo con E2E_PRIVATE_URL y E2E_PRIVATE_PASSWORD')

test('sin contraseña, nada; con ella, el replay se carga y se pinta', async ({ page, request }) => {
  expect((await request.get(`${BASE}/data/v1/catalog.json`)).status()).toBe(401)
  await page.goto(`${BASE}/replay?s=${SESSION}`)
  await expect(page).toHaveURL(/\/__acceso\?next=/)
  await page.getByLabel(/Contraseña/).fill('contraseña-incorrecta')
  await page.getByRole('button', { name: /Entrar/ }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await page.getByLabel(/Contraseña/).fill(PASSWORD!)
  await page.getByRole('button', { name: /Entrar/ }).click()
  await expect(page).toHaveURL(new RegExp(`/replay\\?s=${SESSION.replace(/\//g, '\\/')}$`))
  await expect(page.getByTestId('replay-status')).toHaveAttribute('data-state', 'ready', { timeout: 30_000 })
  await expect.poll(async () => (await page.evaluate(() => window.__trazada?.scene.ready)) ?? false, { timeout: 30_000 }).toBe(true)
  expect(await page.evaluate(() => window.__trazada!.scene.instances)).toBeGreaterThan(0)
})
