import { type ChildProcess, spawn } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, type Locator, type Page, test } from '@playwright/test'
import { gotoApp, markTipsSeen } from './helpers'

const FP1 = '2026/10-spa-francorchamps/fp1'
const SPA = '/?season=2026&event=10-spa-francorchamps'
const here = fileURLToPath(new URL('.', import.meta.url))

test.describe('selector de sesiones', () => {
  test('temporada → Gran Premio → sesión, con progreso hasta "listo"', async ({ page }) => {
    // Retrasa los ficheros de datos para que el progreso sea observable.
    await page.route('**/data/v1/sessions/**/*.gz', async (route) => {
      await new Promise((r) => setTimeout(r, 400))
      await route.continue()
    })
    await gotoApp(page, '/')
    await expect(page.getByTestId('season-2026')).toHaveAttribute('aria-pressed', 'true')
    await page.getByTestId('event-spa-francorchamps').click()
    await expect(page.getByTestId('session-fp1')).toBeVisible()
    await page.getByTestId('session-fp1').click()

    await expect(page).toHaveURL(new RegExp(`/replay\\?s=${FP1.replaceAll('/', '%2F')}|/replay\\?s=${FP1}`))
    await expect(page.getByTestId('load-progress')).toBeVisible()
    await expect(page.getByTestId('replay-status')).toHaveAttribute('data-state', 'ready', { timeout: 15_000 })
    await expect(page.getByTestId('replay-title')).toContainText('Belgian Grand Prix')
  })

  test('cada Gran Premio lleva la miniatura del trazado y la bandera del país', async ({ page, baseURL }) => {
    await page.context().addCookies([{ name: 'trazada_lang', value: 'es', url: baseURL! }])
    await gotoApp(page, '/')
    const card = page.getByTestId('event-spa-francorchamps')
    await expect(card.getByTestId('track-outline').locator('path')).toHaveAttribute('d', /^M[\d. ]+Z$/)
    await expect(card.getByTestId('flag')).toHaveAttribute('data-iso', 'BE')
    // Nombre del país en el idioma de la interfaz (Intl), no el texto en inglés del calendario.
    const meta = card.locator('.tz-event__meta')
    await expect(meta).toContainText('Bélgica')
    await expect(meta).not.toContainText('Belgium')
    // Sin peticiones externas: la bandera va incrustada.
    expect(await card.getByTestId('flag').getAttribute('src')).toMatch(/^data:image\/svg\+xml,/)
  })

  test('temporada sin datos → estado vacío', async ({ page }) => {
    await gotoApp(page, '/')
    await page.getByTestId('season-2025').click()
    await expect(page.getByTestId('season-empty')).toBeVisible()
    await expect(page).toHaveURL(/season=2025/)
  })

  test('sesión no-position: visible pero no disponible', async ({ page }) => {
    await gotoApp(page, SPA)
    const fp2 = page.getByTestId('session-fp2')
    await expect(fp2).toBeVisible()
    await expect(fp2).toHaveAttribute('aria-disabled', 'true')
    await expect(fp2.locator('a')).toHaveCount(0)
  })

  test('el estado del selector sobrevive a la navegación atrás', async ({ page }) => {
    await gotoApp(page, '/')
    await page.getByTestId('event-spa-francorchamps').click()
    await page.getByTestId('session-fp1').click()
    await expect(page.getByTestId('replay-status')).toBeVisible({ timeout: 15_000 })
    await page.goBack()
    await expect(page.getByTestId('session-fp1')).toBeVisible()
  })
})

// ---------------------------------------------------------------------------------------------------------
// Pulido de la portada (Tanda 5, worker A): iconos (D30), jerarquía con la identidad «Asfalto y pintura» (D44,
// D47) y microinteracciones con los tokens de movimiento (D42).

/** Color CSS calculado → [r, g, b] (0–255). */
const channels = (css: string) => css.match(/[\d.]+/g)!.slice(0, 3).map(Number) as [number, number, number]

/** Contraste WCAG entre dos colores CSS calculados. */
function contrast(a: string, b: string): number {
  const lum = (css: string) => {
    const [r, g, bl] = channels(css).map((c) => {
      const v = c / 255
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    }) as [number, number, number]
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** "24ms", "0.024s" o "0s" → ms. */
const ms = (raw: string) => (raw.trim().endsWith('ms') ? Number.parseFloat(raw) : Number.parseFloat(raw) * 1000)

/** Valor calculado de un token de :root. */
const tokenValue = (page: Page, name: string) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name)

/** Color que resuelve un token (con una sonda, igual que lo resolvería un componente). */
const tokenColor = (page: Page, name: string) =>
  page.evaluate((n) => {
    const probe = document.createElement('span')
    probe.style.color = `var(${n})`
    document.body.append(probe)
    const color = getComputedStyle(probe).color
    probe.remove()
    return color
  }, name)

/** Animación calculada de cada elemento. */
const animations = (loc: Locator) =>
  loc.evaluateAll((els) =>
    els.map((el) => {
      const s = getComputedStyle(el)
      return { name: s.animationName, duration: s.animationDuration, delay: s.animationDelay }
    }),
  )

test.describe('portada: identidad, iconos y estados', () => {
  test('marca en condensada con el piano debajo; la temporada elegida es una placa maciza de pintura que se lee', async ({ page }) => {
    await gotoApp(page, '/')
    const brand = page.getByTestId('brand')
    const font = await brand.evaluate((el) => {
      const s = getComputedStyle(el)
      return { family: s.fontFamily, transform: s.textTransform }
    })
    expect(font.family).toMatch(/Barlow Condensed/)
    expect(font.transform).toBe('uppercase')

    // Piano: diez bloques de --tz-kerb-block bajo la marca, decorativo (sin eventos).
    const header = page.locator('.tz-header')
    const kerb = await header.evaluate((el) => {
      const s = getComputedStyle(el, '::after')
      return { image: s.backgroundImage, width: s.width, height: s.height, left: s.left, events: s.pointerEvents }
    })
    expect(kerb.image).toMatch(/repeating-linear-gradient/)
    expect(Number.parseFloat(kerb.width)).toBe(10 * Number.parseFloat(await tokenValue(page, '--tz-kerb-block')))
    expect(kerb.height).toBe('3px')
    expect(kerb.events).toBe('none')
    const [brandBox, headerBox] = [await brand.boundingBox(), await header.boundingBox()]
    expect(Math.abs(brandBox!.x - headerBox!.x - Number.parseFloat(kerb.left))).toBeLessThanOrEqual(1)

    // Placa maciza = activado (D47): fondo de pintura y texto --tz-accent-on, legible.
    const active = page.getByTestId('season-2026')
    await expect(active).toHaveAttribute('aria-pressed', 'true')
    const paint = await tokenColor(page, '--tz-paint')
    const plate = await active.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(el).color }))
    expect(plate.bg).toBe(paint)
    expect(plate.fg).toBe(await tokenColor(page, '--tz-accent-on'))
    expect(contrast(plate.fg, plate.bg)).toBeGreaterThanOrEqual(4.5)
    // Las demás, solo contorno.
    const other = page.getByTestId('season-2025')
    await expect(other).toHaveAttribute('aria-pressed', 'false')
    expect(await other.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
  })

  test('el cambio de idioma lleva su icono junto al código del otro idioma, con el nombre accesible completo', async ({ page }) => {
    await gotoApp(page, '/')
    const lang = page.getByTestId('lang-toggle')
    await expect(lang.locator('svg[data-icon="language"]')).toHaveAttribute('aria-hidden', 'true')
    await expect(lang).toHaveText(/^(EN|ES)$/)
    await expect(lang).toHaveAccessibleName(/(inglés|Spanish)/)
  })

  test('tarjetas de Gran Premio: trazado, bandera y nombre en Barlow; la elegida, anillo de pintura completo (D50)', async ({ page }) => {
    await gotoApp(page, '/')
    const card = page.getByTestId('event-spa-francorchamps')
    await expect(card).toHaveAttribute('aria-pressed', 'false')
    expect(await card.locator('.tz-event__name').evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"?Barlow"?,/)
    // Anillo completo de 1,5 px, nunca una franja lateral.
    const stripe = /0px 0px 0px 1[.]5px inset/
    expect(await card.evaluate((el) => getComputedStyle(el).boxShadow)).not.toMatch(stripe)
    await card.click()
    await expect(card).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => card.evaluate((el) => getComputedStyle(el).boxShadow)).toMatch(stripe)
  })

  test('filas de sesión: estado claro, iconos junto al texto y el motivo de «No disponible» a la vista', async ({ page }) => {
    await gotoApp(page, SPA)
    // Lista para ver: toda la fila es el enlace, con el icono de abrir (decorativo).
    const fp1 = page.getByTestId('session-fp1')
    await expect(fp1.locator('svg[data-icon="play"]')).toHaveAttribute('aria-hidden', 'true')
    await expect(fp1).toHaveAccessibleName(/(Libres 1|Practice 1)/)
    // Sin posiciones: el motivo, en texto visible (en iPad un title no se ve), con el icono de «sin señal».
    const fp2 = page.getByTestId('session-fp2')
    const reason = fp2.getByTestId('unavailable-reason')
    await expect(reason).toBeVisible()
    await expect(reason).toContainText(/(posición|position)/)
    await expect(reason.locator('svg[data-icon="noSignal"]')).toHaveAttribute('aria-hidden', 'true')
    await expect(fp2).toHaveAttribute('data-state', 'unavailable')
    // Todo <svg> de la portada es un icono del registro o un trazado (dato), nunca un dibujo suelto.
    await expect(page.locator('main svg:not([data-icon]):not(.tz-outline)')).toHaveCount(0)
  })

  test('«Elige un Gran Premio» y la temporada vacía son huecos con contorno discontinuo, sin contenido inventado', async ({ page }) => {
    await gotoApp(page, '/?season=2026')
    const pick = page.locator('.tz-sessions .tz-selector__state')
    await expect(pick).toBeVisible()
    expect(await pick.evaluate((el) => getComputedStyle(el).borderStyle)).toBe('dashed')
    await page.getByTestId('season-2025').click()
    const empty = page.getByTestId('season-empty')
    await expect(empty).toBeVisible()
    expect(await empty.evaluate((el) => getComputedStyle(el).borderStyle)).toBe('dashed')
  })

  test('panel de carga: el error lleva su icono junto al texto, las acciones su icono y nada de backdrop-filter', async ({ page }) => {
    await gotoApp(page, '/replay?s=2026/99-nowhere/race')
    const error = page.getByTestId('load-error')
    await expect(error).toHaveAttribute('data-code', 'not-found')
    await expect(error.locator('.tz-load__message svg[data-icon="error"]')).toHaveAttribute('aria-hidden', 'true')
    await expect(error.locator('.tz-load__message')).not.toBeEmpty()
    const back = page.getByTestId('load-back')
    await expect(back.locator('svg[data-icon="back"]')).toHaveAttribute('aria-hidden', 'true')
    await expect(back).toHaveAccessibleName(/(selector)/)
    const panel = page.getByTestId('load-panel')
    expect(await panel.evaluate((el) => getComputedStyle(el).backdropFilter)).toBe('none')
    expect(await panel.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(await tokenColor(page, '--tz-overlay'))
  })
})

test.describe('portada: microinteracciones (D42)', () => {
  /** Otra temporada y vuelta, y el Gran Premio otra vez: las listas que el usuario cambia se vuelven a montar. */
  async function changeLists(page: Page) {
    await page.getByTestId('season-2025').click()
    await expect(page.getByTestId('season-empty')).toBeVisible()
    await page.getByTestId('season-2026').click()
    await page.getByTestId('event-spa-francorchamps').click()
    await expect(page.getByTestId('session-race')).toBeVisible()
  }
  const cards = (page: Page) => animations(page.locator('.tz-event-list > li'))
  const sessions = (page: Page) => animations(page.locator('.tz-session-list > li'))

  test('al cargar, quietas; tras elegir temporada o Gran Premio, tarjetas y sesiones entran escalonadas con los tokens', async ({ page }) => {
    await gotoApp(page, SPA)
    await expect(page.getByTestId('session-race')).toBeVisible()
    // La portada aparece quieta: nada se lee (ni se mide) a medio fundir.
    for (const a of [...(await cards(page)), ...(await sessions(page))]) expect(a.name).toBe('none')

    await changeLists(page)
    const step = ms(await tokenValue(page, '--tz-stagger'))
    const enter = ms(await tokenValue(page, '--tz-dur-base'))
    expect(step).toBeGreaterThan(0)
    const c = await cards(page)
    expect(c.length).toBeGreaterThan(0)
    for (const a of c) expect(a.name).toBe('tz-enter')
    expect(ms(c[0]!.delay)).toBe(0)
    const s = await sessions(page)
    expect(s.length).toBeGreaterThanOrEqual(3)
    s.forEach((a, i) => {
      expect(a.name).toBe('tz-enter')
      expect(ms(a.duration)).toBeCloseTo(enter, 0)
      expect(ms(a.delay)).toBeCloseTo(i * step, 0)
    })

    // Nunca se anima un dato (D42): ni la ronda, ni el país, ni el tamaño de la sesión.
    const data = page.locator('.tz-event__round, .tz-event__meta, .tz-session__size')
    expect(await data.count()).toBeGreaterThan(0)
    for (const style of await data.evaluateAll((els) =>
      els.map((el) => ({ animation: getComputedStyle(el).animationName, transition: getComputedStyle(el).transitionDuration })),
    )) {
      expect(style.animation).toBe('none')
      expect(ms(style.transition)).toBe(0)
    }
  })

  test('con prefers-reduced-motion nada se mueve: duraciones y escalonado a 0 y escala neutra al pulsar', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await gotoApp(page, SPA)
    await expect(page.getByTestId('session-race')).toBeVisible()
    await changeLists(page)
    const all = [...(await cards(page)), ...(await sessions(page))]
    expect(all.length).toBeGreaterThan(0)
    for (const a of all) {
      expect(ms(a.duration)).toBe(0)
      expect(ms(a.delay)).toBe(0)
    }
    const season = page.getByTestId('season-2026')
    expect(ms(await season.evaluate((el) => getComputedStyle(el).transitionDuration.split(',')[0]!))).toBe(0)
    expect(Number.parseFloat(await tokenValue(page, '--tz-press-scale'))).toBe(1)
  })
})

// ---------------------------------------------------------------------------------------------------------
// Con el gestor de datos (D26): la fila destella una sola vez al terminar la descarga, y sus acciones llevan icono.

test.describe('portada con el gestor de datos', () => {
  test.describe.configure({ mode: 'serial' })

  let server: ChildProcess
  let dataDir: string
  let base: string

  test.beforeAll(async () => {
    dataDir = join(mkdtempSync(join(tmpdir(), 'trazada-portada-')), 'data')
    cpSync(resolve(here, '../fixtures/data'), dataDir, { recursive: true })
    // Puertos propios (manager.spec usa 4300 + worker; readme-shots, 4390).
    const port = 4350 + test.info().workerIndex
    base = `http://127.0.0.1:${port}`
    server = spawn(process.execPath, [resolve(here, 'manager-server.mjs'), '--port', String(port), '--data', dataDir], {
      env: { ...process.env, FAKE_STEP_MS: '400' },
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

  test('descargar: icono junto al texto; al terminar, un destello único y la fila pasa a ser el enlace', async ({ page }) => {
    await markTipsSeen(page)
    await page.goto(`${base}/?season=2026&event=03-suzuka`)
    await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true')
    await expect(page.getByTestId('manager')).toBeAttached()

    const download = page.getByTestId('download-fp1')
    await expect(download.locator('svg[data-icon="download"]')).toHaveAttribute('aria-hidden', 'true')
    await expect(download).toHaveAccessibleName(/(Descargar Libres 1|Download Practice 1)/)

    // Registra las filas que llegan a llevar data-fresh (la fila nueva ya nace con él: se mira también lo añadido).
    await page.evaluate(() => {
      const w = window as Window & { __fresh?: string[] }
      w.__fresh = []
      const note = (el: Element) => {
        for (const f of [el, ...el.querySelectorAll('[data-fresh]')]) {
          if (f instanceof HTMLElement && f.hasAttribute('data-fresh')) w.__fresh!.push(f.dataset.testid ?? '')
        }
      }
      new MutationObserver((records) => {
        for (const r of records) {
          if (r.type === 'attributes' && r.target instanceof Element) note(r.target)
          for (const n of r.addedNodes) if (n instanceof Element) note(n)
        }
      }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-fresh'] })
    })

    await download.click()
    const fp1 = page.getByTestId('session-fp1')
    await expect(page.getByTestId('cancel-fp1').locator('svg[data-icon="close"]')).toHaveAttribute('aria-hidden', 'true')
    await expect(fp1).toHaveAttribute('data-state', 'link', { timeout: 15_000 })
    await expect.poll(() => page.evaluate(() => (window as Window & { __fresh?: string[] }).__fresh ?? [])).toContain('session-fp1')
    // Una sola vez: al acabar el destello (--tz-dur-flash), la fila vuelve a su fondo.
    await expect(fp1).not.toHaveAttribute('data-fresh', { timeout: 5000 })
    await expect(fp1).not.toHaveClass(/is-fresh/)
  })

  test('el contador de sesiones listas incompleto no lleva el icono de hecho (el texto n/total lo dice)', async ({ page }) => {
    await markTipsSeen(page)
    await page.goto(`${base}/?season=2026`)
    await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true')
    const yas = page.getByTestId('built-yas-marina')
    await expect(yas).toContainText('0/5')
    await expect(yas.locator('svg[data-icon="check"]')).toHaveCount(0)
  })
})
