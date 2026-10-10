import { expect, type Page } from '@playwright/test'

/** Navega y espera a que la app esté hidratada (interactiva), no solo pintada por SSR. */
export async function gotoApp(page: Page, path: string): Promise<void> {
  await page.goto(path)
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true')
}
