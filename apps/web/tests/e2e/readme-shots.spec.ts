/**
 * Capturas del README (docs/img/*.webp). No es un test: solo corre con README_SHOTS=1.
 *
 *   pnpm build && README_SHOTS=1 PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm e2e readme-shots
 *
 * Muestran los datos de fixture (el extracto de test de Spa 2026, ver DATA_NOTICE.md); la portada, además, el
 * calendario real de la temporada (`trazada schedule`, de la caché de FastF1 o con red: hace falta
 * `cd pipeline && uv sync`). En español, a 1440×900 (y una de tablet).
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, type Page, test } from '@playwright/test'
import { gotoApp } from './helpers'

const here = fileURLToPath(new URL('.', import.meta.url))
const OUT = resolve(here, '../../../../docs/img')
const FP1 = '/replay?s=2026/10-spa-francorchamps/fp1'
/** Un minuto y medio dentro del extracto: coches en pista y una doble amarilla activa. */
const AT_MS = 85_828

test.skip(!process.env.README_SHOTS, 'solo para regenerar las capturas del README (README_SHOTS=1)')
test.describe.configure({ mode: 'serial' })
test.use({ locale: 'es-ES', viewport: { width: 1440, height: 900 } })

/** Captura de la página en WebP (texto nítido y unas decenas de KB). */
async function shot(page: Page, name: string) {
  await page.mouse.move(0, 0)
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  const png = (await page.screenshot()).toString('base64')
  const webp = await page.evaluate(async (png) => {
    const img = new Image()
    img.src = `data:image/png;base64,${png}`
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.width
    c.height = img.height
    c.getContext('2d')!.drawImage(img, 0, 0)
    return c.toDataURL('image/webp', 0.9).split(',')[1]!
  }, png)
  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, `${name}.webp`), Buffer.from(webp, 'base64'))
}

async function spanish(page: Page, url: string) {
  await page.context().addCookies([{ name: 'trazada_lang', value: 'es', url }])
}

async function openReplay(page: Page, baseURL: string, settings: object = {}) {
  await spanish(page, baseURL)
  await page.addInitScript((s) => localStorage.setItem('trazada.settings', JSON.stringify(s)), settings)
  await gotoApp(page, FP1)
  await expect.poll(async () => (await page.evaluate(() => window.__trazada?.scene.ready)) ?? false, { timeout: 15_000 }).toBe(true)
  await page.evaluate((at) => window.__trazada!.seek(window.__trazada!.startMs + at), AT_MS)
  await page.waitForTimeout(800)
}

async function follow(page: Page, nth: number) {
  await page.locator('[data-testid="leaderboard"] [data-car]').nth(nth).getByRole('button').click()
  await page.getByTestId('follow-toggle').click()
  await expect.poll(() => page.evaluate(() => window.__trazada!.scene.cameraMode), { timeout: 5000 }).toBe('follow')
  await page.waitForTimeout(800)
}

test('portada: calendario de la temporada con banderas, trazados y descargas', async ({ page }) => {
  const dataDir = join(mkdtempSync(join(tmpdir(), 'trazada-readme-')), 'data')
  cpSync(resolve(here, '../fixtures/data'), dataDir, { recursive: true })
  const port = 4390
  const base = `http://127.0.0.1:${port}`
  const server: ChildProcess = spawn(process.execPath, [resolve(here, 'readme-server.mjs'), '--port', String(port), '--data', dataDir], { stdio: 'ignore' })
  try {
    await expect.poll(async () => (await fetch(`${base}/`).catch(() => null))?.status ?? 0, { timeout: 15_000 }).toBe(200)
    await spanish(page, base)
    await page.goto(`${base}/?season=2026`)
    await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true')
    await expect(page.getByTestId('event-melbourne')).toBeVisible({ timeout: 60_000 })
    await page.getByTestId('event-spa-francorchamps').click()
    await expect(page.getByTestId('session-fp1')).toBeVisible()
    await shot(page, 'portada')
  } finally {
    server.kill()
    rmSync(resolve(dataDir, '..'), { recursive: true, force: true })
  }
})

test('replay: vista general con clasificación, dirección de carrera y timeline', async ({ page, baseURL }) => {
  await openReplay(page, baseURL!)
  await shot(page, 'replay')
})

test('siguiendo a un coche: modelo 3D, telemetría y gráficas', async ({ page, baseURL }) => {
  await openReplay(page, baseURL!, { followDistance: 24 })
  await follow(page, 0)
  await shot(page, 'coche')
})

test('tablet en vertical', async ({ browser, baseURL }) => {
  const page = await browser.newPage({ viewport: { width: 768, height: 1024 }, hasTouch: true, locale: 'es-ES' })
  await openReplay(page, baseURL!)
  await shot(page, 'tablet')
  await page.close()
})
