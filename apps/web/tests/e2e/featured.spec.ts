/**
 * El Gran Premio del momento en la portada (pendiente 6d del PLAN): con fecha en el catálogo, arriba y en grande, el del
 * fin de semana en curso («Este fin de semana») o, pasado ese fin de semana, el último («Último Gran Premio»), con sus
 * sesiones (la descargada se abre desde ahí) y antes de «Seguir viendo» y del selector. Sin fechas, no sale.
 */
import { expect, type Page, test } from '@playwright/test'
import { gotoApp } from './helpers'

/** El catálogo del fixture, con el primer día del Gran Premio de Bélgica (el fixture no trae fechas). */
async function withDates(page: Page) {
  await page.route('**/v1/catalog.json', async (route) => {
    const res = await route.fetch()
    const catalog = await res.json()
    for (const s of catalog.seasons) for (const e of s.events) if (e.slug === 'spa-francorchamps') e.dateStart = '2026-07-24'
    await route.fulfill({ response: res, json: catalog })
  })
}

test('el fin de semana del Gran Premio, arriba y en grande, con sus sesiones; luego el selector', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-07-25T12:00:00'))
  await withDates(page)
  await gotoApp(page, '/')
  const card = page.getByTestId('featured-event')
  await expect(card).toBeVisible()
  await expect(card).toHaveAttribute('data-when', 'live')
  await expect(card.getByRole('heading', { level: 2 })).toContainText('Belgian Grand Prix')
  await expect(card).toContainText(/Este fin de semana|This weekend/)
  // Va antes del selector de temporadas.
  const [cardBox, seasonsBox] = [await card.boundingBox(), await page.locator('.tz-seasons').boundingBox()]
  expect(cardBox!.y + cardBox!.height).toBeLessThanOrEqual(seasonsBox!.y)
  // La sesión descargada se abre desde la ficha.
  await expect(card.getByTestId('featured-session-fp1')).toHaveAttribute('data-state', 'link')
  await card.getByTestId('featured-session-fp1').click()
  await expect(page).toHaveURL(/replay\?s=2026\/10-spa-francorchamps\/fp1/)
})

test('pasado el fin de semana, el último Gran Premio; sin fechas, nada', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-08-10T12:00:00'))
  await withDates(page)
  await gotoApp(page, '/')
  await expect(page.getByTestId('featured-event')).toHaveAttribute('data-when', 'last')
  await expect(page.getByTestId('featured-event')).toContainText(/Último Gran Premio|Latest Grand Prix/)
})

test('sin fechas en el catálogo, la portada de siempre', async ({ page }) => {
  await gotoApp(page, '/')
  await expect(page.getByTestId('event-spa-francorchamps')).toBeVisible()
  await expect(page.getByTestId('featured-event')).toHaveCount(0)
})
