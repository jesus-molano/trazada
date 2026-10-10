/**
 * Gestor de datos local (D26) con `pnpm local`: calendario por temporada y descargas con un clic. El servidor es
 * el real (scripts/local-server.mjs); el pipeline, uno falso con las mismas líneas de progreso.
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { gotoApp } from './helpers'

const here = fileURLToPath(new URL('.', import.meta.url))

test.describe('gestor de datos local', () => {
  test.describe.configure({ mode: 'serial' })

  let server: ChildProcess
  let dataDir: string
  let base: string

  test.beforeAll(async () => {
    dataDir = join(mkdtempSync(join(tmpdir(), 'trazada-manager-')), 'data')
    cpSync(resolve(here, '../fixtures/data'), dataDir, { recursive: true })
    const port = 4300 + test.info().workerIndex
    base = `http://127.0.0.1:${port}`
    server = spawn(process.execPath, [resolve(here, 'manager-server.mjs'), '--port', String(port), '--data', dataDir], {
      env: { ...process.env, FAKE_STEP_MS: '500' },
      stdio: 'ignore',
    })
    await expect
      .poll(async () => (await fetch(`${base}/`).catch(() => null))?.status ?? 0, { timeout: 15_000 })
      .toBe(200)
  })

  test.afterAll(() => {
    server?.kill()
    rmSync(resolve(dataDir, '..'), { recursive: true, force: true })
  })

  const open = async (page: Page, query: string) => {
    await page.goto(`${base}/${query}`)
    await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true')
    await expect(page.getByTestId('manager')).toBeAttached()
  }

  test('una sesión pasada se descarga con un clic: progreso y, al terminar, enlace al replay', async ({ page }) => {
    await open(page, '?season=2026')
    // El calendario completo de la temporada, no solo lo ya generado.
    await expect(page.getByTestId('event-suzuka')).toBeVisible()
    await expect(page.getByTestId('event-yas-marina')).toBeVisible()
    await expect(page.getByTestId('built-suzuka')).toContainText('0/5')
    // Bélgica: de sus 6 sesiones, 4 se pueden ver; Libres 2 se generó sin posiciones («No disponible») y no cuenta.
    await expect(page.getByTestId('built-spa-francorchamps')).toContainText('4/6')
    await page.getByTestId('event-suzuka').click()

    const fp1 = page.getByTestId('session-fp1')
    await expect(fp1).toHaveAttribute('data-state', 'download')
    await page.getByTestId('download-fp1').click()
    await expect(fp1).toHaveAttribute('data-state', /queued|running/)
    await expect(page.getByTestId('progress-fp1')).toBeVisible()
    await expect(page.getByTestId('download-queue')).toBeVisible()
    await expect
      .poll(async () => Number(await page.getByTestId('progress-fp1').getAttribute('aria-valuenow').catch(() => 0)))
      .toBeGreaterThan(0)

    await expect(fp1).toHaveAttribute('data-state', 'link', { timeout: 15_000 })
    await expect(fp1).toHaveAttribute('href', /\/replay\?s=2026\/03-suzuka\/fp1/)
    // El pipeline falso marca Suzuka como dev (su circuito usa fuentes dev): la insignia sale ya.
    await expect(fp1.locator('.tz-badge--dev')).toBeVisible()
    await expect(page.getByTestId('built-suzuka')).toContainText('1/5')
    await expect(page.getByTestId('download-queue')).toHaveCount(0)
  })

  test('un fallo se explica y se puede reintentar', async ({ page }) => {
    await open(page, '?season=2026&event=03-suzuka')
    await page.getByTestId('download-q').click()
    const q = page.getByTestId('session-q')
    await expect(q).toHaveAttribute('data-state', 'error', { timeout: 15_000 })
    await expect(page.getByTestId('error-q')).toContainText(/F1 (no ha devuelto|returned no)/)
    await q.locator('summary').click()
    await expect(q.locator('pre')).toContainText('EmptySessionError')
    await page.getByTestId('retry-q').click()
    await expect(q).toHaveAttribute('data-state', /queued|running/)
    await expect(q).toHaveAttribute('data-state', 'error', { timeout: 15_000 })
  })

  test('una descarga en curso se puede cancelar, con el teclado y sin perder el foco', async ({ page }) => {
    await open(page, '?season=2026&event=10-spa-francorchamps')
    const sq = page.getByTestId('session-sq')
    await expect(sq).toHaveAttribute('data-state', 'download')
    await page.getByTestId('download-sq').focus()
    await page.keyboard.press('Enter')
    await expect(sq).toHaveAttribute('data-state', 'running')
    await expect(page.getByTestId('cancel-sq')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(sq).toHaveAttribute('data-state', 'download', { timeout: 10_000 })
    await expect(page.getByTestId('download-sq')).toBeFocused()
  })

  test('las sesiones futuras no se ofrecen; las carreras que faltan, en bloque', async ({ page }) => {
    await open(page, '?season=2026&event=23-yas-marina')
    const race = page.getByTestId('session-race')
    await expect(race).toHaveAttribute('data-state', 'future')
    await expect(race).toHaveAttribute('aria-disabled', 'true')
    await expect(page.getByTestId('download-race')).toHaveCount(0)
    // Pasadas sin generar: solo la de Suzuka (Bélgica ya está; Abu Dabi es futura).
    const bulk = page.getByTestId('download-season-races')
    await expect(bulk).toContainText('1')
    await bulk.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('download-queue')).toBeVisible()
    // El botón de bloque desaparece: el foco pasa a «Cancelar todo», no se pierde.
    await expect(bulk).toHaveCount(0)
    await expect(page.getByTestId('cancel-all')).toBeFocused()
    await page.getByTestId('event-suzuka').click()
    await expect(page.getByTestId('session-race')).toHaveAttribute('data-state', 'link', { timeout: 15_000 })
    await expect(page.getByTestId('download-season-races')).toHaveCount(0)
  })

  test('en tablet, las tarjetas de una misma fila miden lo mismo aunque un nombre ocupe dos líneas', async ({ page }) => {
    for (const width of [1024, 768]) {
      await page.setViewportSize({ width, height: 1024 })
      await open(page, '?season=2026')
      await expect(page.getByTestId('event-yas-marina')).toBeVisible()
      const boxes = await page.locator('.tz-event').evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect()
          return { top: Math.round(r.top), height: Math.round(r.height) }
        }),
      )
      const rows = new Map<number, number[]>()
      for (const b of boxes) rows.set(b.top, [...(rows.get(b.top) ?? []), b.height])
      for (const heights of rows.values()) expect(Math.max(...heights) - Math.min(...heights), `${width}px`).toBeLessThanOrEqual(1)
    }
  })

  test('accesible con descargas en curso y errores', async ({ page }) => {
    await open(page, '?season=2026&event=03-suzuka')
    await page.getByTestId('download-fp2').click()
    await expect(page.getByTestId('session-fp2')).toHaveAttribute('data-state', 'running')
    await expect(page.getByTestId('session-q')).toHaveAttribute('data-state', 'error')
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    const serious = results.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)
    expect(serious).toEqual([])
    await page.getByTestId('cancel-all').click()
    await expect(page.getByTestId('download-queue')).toHaveCount(0)
  })
})

test('sin gestor (servidor estático), el selector no ofrece descargas', async ({ page }) => {
  await gotoApp(page, '/?season=2026&event=10-spa-francorchamps')
  await expect(page.getByTestId('session-fp1')).toBeVisible()
  await expect(page.getByTestId('manager')).toHaveCount(0)
  await expect(page.locator('[data-testid^="download-"]')).toHaveCount(0)
})
