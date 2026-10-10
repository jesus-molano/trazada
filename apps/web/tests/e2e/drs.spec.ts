/**
 * Zonas de DRS (ítem 11, D38) sobre el fixture de Spa 2026. En 2026 no hay DRS: la herramienta del menú «Capas» lo
 * dice («En 2026 no hay datos de zonas ni de modo adelantamiento por coche»), no se dibuja ninguna zona (la capa
 * existe con 0 draw calls), no sale ninguna etiqueta «Estimado» y la escena sigue en su presupuesto. Con un manifest
 * de 2025 que declara el canal (el fixture no trae códigos DRS: todo 255), «sin dato» y tampoco hay zonas: nunca se
 * dibuja una zona inventada.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { gotoApp, resetStorage } from './helpers'

const FP1 = '/replay?s=2026/10-spa-francorchamps/fp1'
const T_MS = 85_828

interface DrsStats {
  status: 'deduced' | 'insufficient' | 'season' | 'no-channel'
  zones: number
  shown: boolean
  enabled: boolean
  drawCalls: number
  triangles: number
  fogged: boolean
  cars: number
  spans: number[]
}

const twoFrames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
const drsStats = (page: Page) => page.evaluate(() => window.__trazada!.scene.drsZones as DrsStats)
const scene = (page: Page) => page.evaluate(() => ({ ...window.__trazada!.scene }))

async function openScene(page: Page) {
  await gotoApp(page, FP1)
  await expect.poll(async () => (await page.evaluate(() => window.__trazada?.scene.ready)) ?? false, { timeout: 15_000 }).toBe(true)
  await page.evaluate((t) => window.__trazada!.seek(window.__trazada!.startMs + t), T_MS)
  await twoFrames(page)
}

/** La herramienta va en el menú «Capas» de las herramientas de escena: lo abre si está cerrado. */
async function openLayers(page: Page) {
  const button = page.getByTestId('tools-layers')
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click()
  await expect(page.getByTestId('drs-tool')).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await resetStorage(page)
})

test('2026: la leyenda dice que no hay datos de zonas; sin zonas, sin «Estimado» y sin draw calls', async ({ page }) => {
  await openScene(page)
  await openLayers(page)
  const tool = page.getByTestId('drs-tool')
  await expect(tool).toHaveAttribute('data-status', 'season')
  await expect(page.getByTestId('drs-note')).toHaveText(
    /^(En 2026 no hay datos de zonas ni de modo adelantamiento por coche|In 2026 there is no zone or per-car overtake mode data)$/,
  )
  // Nada que activar ni que etiquetar: no se pinta nada estimado.
  await expect(page.getByTestId('drs-on')).toHaveCount(0)
  await expect(page.getByTestId('drs-legend')).toHaveCount(0)
  await expect(page.locator('[data-testid="estimated"][data-field="drsZones"]')).toHaveCount(0)

  const stats = await drsStats(page)
  expect(stats).toMatchObject({ status: 'season', zones: 0, shown: false, drawCalls: 0, triangles: 0, fogged: false, spans: [] })
  const s = await scene(page)
  expect(s.layers.find((l) => l.name === 'drsZones')).toMatchObject({ drawCalls: 0, triangles: 0, fogged: false })
  expect(s.drawCalls).toBeLessThanOrEqual(13 + s.layers.reduce((n, l) => n + l.drawCalls, 0))
  expect(s.drawCalls).toBeLessThan(30)

  // La pista ⓘ explica por qué: desde 2026 no hay DRS ni canal por coche.
  await page.getByTestId('drs-hint').click()
  await expect(page.getByTestId('drs-hint-panel')).toBeVisible()
  await expect(page.getByTestId('drs-hint-panel')).toContainText(/2026/)
  const results = await new AxeBuilder({ page })
    .include('[data-testid="scene-tools"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([])
})

test('2025 con el canal declarado pero sin códigos en la telemetría: «sin dato», nunca zonas inventadas', async ({ page }) => {
  // El manifest no va firmado (los ficheros sí): se cambia la temporada y el canal como los traería una sesión de 2025.
  await page.route('**/sessions/2026/10-spa-francorchamps/fp1/manifest.json', async (route) => {
    const res = await route.fetch()
    const manifest = await res.json()
    manifest.session.season = 2025
    manifest.channels.drs = 'present'
    await route.fulfill({ response: res, json: manifest })
  })
  await openScene(page)
  await openLayers(page)
  await expect(page.getByTestId('drs-tool')).toHaveAttribute('data-status', 'no-channel')
  await expect(page.getByTestId('drs-note')).toHaveText(/^(Sin dato|No data):/)
  await expect(page.getByTestId('drs-on')).toHaveCount(0)
  await expect(page.locator('[data-testid="estimated"][data-field="drsZones"]')).toHaveCount(0)
  expect(await drsStats(page)).toMatchObject({ status: 'no-channel', zones: 0, drawCalls: 0, triangles: 0 })
})

test('sin zonas, la capa no provoca renders en pausa', async ({ page }) => {
  await openScene(page)
  let before = -1
  await expect
    .poll(
      async () => {
        const now = await page.evaluate(() => window.__trazada!.renders)
        const stable = now === before
        before = now
        return stable
      },
      { intervals: [400], timeout: 10_000 },
    )
    .toBe(true)
  await page.waitForTimeout(500)
  expect(await page.evaluate(() => window.__trazada!.renders)).toBe(before)
})
