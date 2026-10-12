/**
 * Capturas del README (docs/img/*.webp). No es un test: solo corre con README_SHOTS=1.
 *
 *   pnpm build && README_SHOTS=1 PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm e2e readme-shots
 *
 * Muestran los datos de fixture (el extracto de test de Spa 2026, ver DATA_NOTICE.md); la portada, además, el
 * calendario real de la temporada (`trazada schedule`, de la caché de FastF1 o con red: hace falta
 * `cd pipeline && uv sync`). En español, a 1440×900 (y una de tablet). La portada levanta su propio servidor (el de
 * `pnpm local`, con el gestor) en el puerto 4390, o en `README_PORT` si ese está ocupado.
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, type Page, test } from '@playwright/test'
import { gotoApp, markTipsSeen } from './helpers'

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

/** Draw calls del mapa de calor (1 si está pintado). */
const heatDrawCalls = (page: Page) =>
  page.evaluate(() => (window.__trazada!.scene.heat as { drawCalls: number } | undefined)?.drawCalls ?? 0)

/** Sigue a un coche por su número: quién va primero depende de la torre de tiempos del fixture, no de la escena. */
async function follow(page: Page, car: string) {
  await page.locator(`[data-testid="leaderboard"] [data-car="${car}"]`).getByRole('button').click()
  await page.getByTestId('follow-toggle').click()
  await expect.poll(() => page.evaluate(() => window.__trazada!.scene.cameraMode), { timeout: 5000 }).toBe('follow')
  await page.waitForTimeout(800)
}

test('portada: calendario de la temporada con banderas, trazados y descargas', async ({ page }) => {
  const dataDir = join(mkdtempSync(join(tmpdir(), 'trazada-readme-')), 'data')
  cpSync(resolve(here, '../fixtures/data'), dataDir, { recursive: true })
  const port = Number(process.env.README_PORT ?? 4390)
  const base = `http://127.0.0.1:${port}`
  const server: ChildProcess = spawn(process.execPath, [resolve(here, 'readme-server.mjs'), '--port', String(port), '--data', dataDir], { stdio: 'ignore' })
  try {
    await expect.poll(async () => (await fetch(`${base}/`).catch(() => null))?.status ?? 0, { timeout: 15_000 }).toBe(200)
    await spanish(page, base)
    await markTipsSeen(page)
    await page.goto(`${base}/?season=2026`)
    await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true')
    await expect(page.getByTestId('event-melbourne')).toBeVisible({ timeout: 60_000 })
    // Un Gran Premio sin descargar: sus sesiones, con «Descargar» (en el de Bélgica están las variantes de
    // prueba de los tests, que no son sesiones reales).
    await page.getByTestId('event-suzuka').click()
    await expect(page.getByTestId('download-fp1')).toBeVisible()
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
  await openReplay(page, baseURL!, { followDistance: 20 })
  await follow(page, '1') // NOR rueda por la pista en ese instante; el primero de la clasificación puede estar en el pit
  // Saliendo de una curva: la cámara gira con algo de retraso y el coche se ve de tres cuartos.
  await page.evaluate((at) => window.__trazada!.seek(window.__trazada!.startMs + at), AT_MS + 15_000)
  await page.waitForTimeout(800)
  await shot(page, 'coche')
})

test('diseño «Análisis»: columnas de la clasificación, telemetría grande y mapa de calor', async ({ page, baseURL }) => {
  await openReplay(page, baseURL!)
  // A mitad de la vuelta 23 de GAS, en pista: ya cerró la 22 (entera dentro del extracto, con posiciones), que el
  // mapa de calor pinta por velocidad (la última; su mejor vuelta es de antes del extracto y sería «sin dato»).
  await page.evaluate(() => window.__trazada!.seek(4_590_000))
  await page.getByTestId('layout-analysis').click()
  await expect(page.locator('.tz-replay')).toHaveAttribute('data-layout', 'analysis')
  await expect(page.getByTestId('lb-columns')).toBeVisible()
  await page.locator('[data-testid="leaderboard"] [data-car="10"]').getByRole('button').click()
  await expect(page.getByTestId('telemetry')).toHaveAttribute('data-car', '10')
  await page.getByTestId('tools-layers').click()
  await page.getByTestId('heat-speed').click()
  await page.getByTestId('heat-pick-last').click()
  await expect(page.getByTestId('heat-tool')).toHaveAttribute('data-status', 'ok')
  await expect.poll(() => heatDrawCalls(page)).toBe(1)
  // El menú «Capas» se cierra con un clic fuera (en el título, no en el lienzo) para que no tape el mapa; el calor
  // sigue pintado.
  await page.getByTestId('replay-title').click()
  await expect(page.getByTestId('heat-tool')).toBeHidden()
  await expect.poll(() => heatDrawCalls(page)).toBe(1)
  await page.waitForTimeout(800)
  await shot(page, 'analisis')
})

test('tablet en vertical', async ({ browser, baseURL }) => {
  const page = await browser.newPage({ viewport: { width: 768, height: 1024 }, hasTouch: true, locale: 'es-ES' })
  await openReplay(page, baseURL!)
  await shot(page, 'tablet')
  await page.close()
})

test('móvil: el mapa entero y la hoja de paneles con la clasificación', async ({ browser, baseURL }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'es-ES' })
  await openReplay(page, baseURL!)
  await page.getByTestId('sheet-tab-lb').click()
  await expect(page.getByTestId('leaderboard')).toBeVisible()
  await shot(page, 'movil')
  await page.close()
})
