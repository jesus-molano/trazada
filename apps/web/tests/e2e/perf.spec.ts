import { expect, test } from '@playwright/test'
import { gotoApp } from './helpers'

declare global {
  interface Window {
    __longTasks: { start: number; duration: number }[]
  }
}

test('de clic a "listo" sin long tasks > 50 ms en el hilo principal (CPU ×4)', async ({ page }) => {
  await page.addInitScript(() => {
    window.__longTasks = []
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__longTasks.push({ start: e.startTime, duration: e.duration })
    }).observe({ type: 'longtask', buffered: true })
  })
  await gotoApp(page, '/?season=2026&event=10-spa-francorchamps')
  await expect(page.getByTestId('session-fp1')).toBeVisible()
  // Deja que termine el trabajo inicial de la página (hidratación, fuentes) antes de medir.
  await page.waitForTimeout(500)

  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  const clickAt = await page.evaluate(() => performance.now())
  await page.getByTestId('session-fp1').click()
  await expect(page.getByTestId('replay-status')).toHaveAttribute('data-state', 'ready', { timeout: 30_000 })
  const readyAt = await page.evaluate(() => performance.now())
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })

  const tasks = await page.evaluate(() => window.__longTasks)
  const inWindow = tasks.filter((t) => t.start + t.duration > clickAt && t.start < readyAt)
  console.log(`clic→listo ${Math.round(readyAt - clickAt)} ms (CPU ×4); long tasks: ${JSON.stringify(inWindow)}`)
  expect(inWindow.filter((t) => t.duration > 50)).toEqual([])
})
