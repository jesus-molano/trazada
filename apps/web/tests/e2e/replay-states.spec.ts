import { expect, test } from '@playwright/test'
import { gotoApp } from './helpers'

const BASE = '2026/10-spa-francorchamps'

test.describe('estados de carga del replay', () => {
  test('sesión inexistente → error', async ({ page }) => {
    await gotoApp(page, '/replay?s=2026/99-nowhere/race')
    await expect(page.getByTestId('load-error')).toHaveAttribute('data-code', 'not-found')
  })

  test('identificador inválido → error sin pedir nada fuera de /v1/sessions', async ({ page }) => {
    const requested: string[] = []
    page.on('request', (r) => requested.push(new URL(r.url()).pathname))
    await gotoApp(page, '/replay?s=..%2F..%2Fetc%2Fpasswd')
    await expect(page.getByTestId('load-error')).toHaveAttribute('data-code', 'not-found')
    expect(requested.filter((p) => p.includes('passwd'))).toEqual([])
  })

  test('fallo de red → error con reintento que funciona', async ({ page }) => {
    let fail = true
    await page.route('**/data/v1/sessions/**/motion.*.trzb.gz', async (route) => {
      if (fail) await route.abort('failed')
      else await route.continue()
    })
    await gotoApp(page, `/replay?s=${BASE}/fp1`)
    await expect(page.getByTestId('load-error')).toHaveAttribute('data-code', 'network')
    fail = false
    await page.getByTestId('load-retry').click()
    await expect(page.getByTestId('replay-status')).toHaveAttribute('data-state', 'ready', { timeout: 15_000 })
  })

  test('sesión sin posiciones → no disponible', async ({ page }) => {
    await gotoApp(page, `/replay?s=${BASE}/fp2`)
    await expect(page.getByTestId('load-error')).toHaveAttribute('data-code', 'no-position')
    await expect(page.getByTestId('load-retry')).toHaveCount(0)
  })

  test('manifest con un major no soportado', async ({ page }) => {
    await gotoApp(page, `/replay?s=${BASE}/fp3`)
    await expect(page.getByTestId('load-error')).toHaveAttribute('data-code', 'unsupported-version')
    await expect(page.getByTestId('load-reload')).toBeVisible()
  })

  test('fichero corrupto → error de integridad', async ({ page }) => {
    await gotoApp(page, `/replay?s=${BASE}/q`)
    await expect(page.getByTestId('load-error')).toHaveAttribute('data-code', 'corrupt')
    await expect(page.getByTestId('load-retry')).toBeVisible()
  })
})

test.describe('WebGL', () => {
  test('sin WebGL → mensaje (los datos se cargan igualmente)', async ({ page }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext
      // @ts-expect-error firma sobrecargada
      HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
        if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') return null
        // @ts-expect-error firma sobrecargada
        return original.call(this, type, ...args)
      }
    })
    await gotoApp(page, `/replay?s=${BASE}/fp1`)
    await expect(page.getByTestId('replay-status')).toHaveAttribute('data-state', 'ready', { timeout: 15_000 })
    await expect(page.getByTestId('webgl-unsupported')).toBeVisible()
  })

  test('contexto perdido → mensaje y recuperación', async ({ page }) => {
    await gotoApp(page, `/replay?s=${BASE}/fp1`)
    const canvas = page.locator('[data-testid="scene"] canvas')
    await expect(canvas).toBeVisible({ timeout: 15_000 })

    // Con el contexto perdido, getExtension devuelve null: se guarda la extensión al perderlo.
    const lose = (restore: boolean) =>
      page.evaluate((restore) => {
        const w = window as unknown as { __loseExt?: WEBGL_lose_context }
        if (restore) {
          w.__loseExt!.restoreContext()
          return
        }
        const el = document.querySelector<HTMLCanvasElement>('[data-testid="scene"] canvas')!
        const gl = el.getContext('webgl2') as WebGL2RenderingContext
        w.__loseExt = gl.getExtension('WEBGL_lose_context')!
        w.__loseExt.loseContext()
      }, restore)

    await lose(false)
    await expect(page.getByTestId('webgl-lost')).toBeVisible()
    await lose(true)
    await expect(page.getByTestId('webgl-lost')).toBeHidden()

    // Recuperación manual: lienzo nuevo
    await lose(false)
    await expect(page.getByTestId('webgl-lost')).toBeVisible()
    await page.getByTestId('webgl-recover').click()
    await expect(page.getByTestId('webgl-lost')).toBeHidden()
    await expect(canvas).toBeVisible()
  })
})
