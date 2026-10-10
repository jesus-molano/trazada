/**
 * El bench (`?bench=1`) funciona: reproduce con los 22 coches y la telemetría abierta y publica sus
 * cifras. Aquí no se valoran (CI no tiene GPU): las medidas de referencia están en docs/PERFORMANCE.md.
 */
import { expect, test } from '@playwright/test'
import { gotoApp } from './helpers'

test('bench corto: resultado completo en window.__trazada.bench y en el panel', async ({ page }) => {
  await gotoApp(page, '/replay?s=2026/10-spa-francorchamps/fp1&bench=1&benchWarmup=1&benchSeconds=2')
  await expect(page.getByTestId('bench')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('bench')).toHaveAttribute('data-status', 'done', { timeout: 20_000 })
  const r = (await page.evaluate(() => window.__trazada!.bench)) as Record<string, unknown>
  expect(r.frames as number).toBeGreaterThan(5)
  for (const k of ['p50', 'p95', 'p99', 'max']) expect(r[k] as number).toBeGreaterThan(0)
  expect(r.p95 as number).toBeGreaterThanOrEqual(r.p50 as number)
  expect(r.telemetryOpen).toBe(true)
  expect(r.visibleCars as number).toBeGreaterThanOrEqual(20)
  expect(r.drawCalls as number).toBeGreaterThan(0)
  expect(r.dpr as number).toBeGreaterThan(0)
  expect(r.heapMB as number).toBeLessThan(300)
  expect(r.session).toBe('2026/10-spa-francorchamps/fp1')
  await expect(page.getByTestId('bench-p95')).not.toBeEmpty()
  await expect(page.getByTestId('telemetry')).toBeVisible()
})
