/**
 * Base visual de la Tanda 0 (D30, D42, D44) sobre el CSS construido de verdad (minificado): tokens de densidad
 * por alto de pantalla y por puntero, tokens de movimiento neutros con prefers-reduced-motion, clases comunes,
 * hover solo con (hover: hover) y la zona táctil de los botones de icono sin mover el layout.
 */
import { expect, type Page, test } from '@playwright/test'
import { gotoApp } from './helpers'

/** Valor calculado de un token en :root. */
function tokenValue(page: Page, name: string) {
  return page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name)
}

/** "24ms", ".024s" o "0s" → ms. */
const ms = (raw: string) => (raw.endsWith('ms') ? Number.parseFloat(raw) : Number.parseFloat(raw) * 1000)

type Rule = { media: string | null; selector?: string; keyframes?: string; text: string }

/** Todas las reglas de estilo y de keyframes de la página, con la media query que las envuelve. */
function cssRules(page: Page): Promise<Rule[]> {
  return page.evaluate(() => {
    const out: Rule[] = []
    const walk = (rules: CSSRuleList, media: string | null) => {
      for (const r of Array.from(rules)) {
        if (r instanceof CSSMediaRule) walk(r.cssRules, r.conditionText)
        else if (r instanceof CSSStyleRule) out.push({ media, selector: r.selectorText, text: r.cssText })
        else if (r instanceof CSSKeyframesRule) out.push({ media, keyframes: r.name, text: r.cssText })
      }
    }
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        walk(sheet.cssRules, sheet.media.mediaText || null)
      } catch {
        // Hoja de otro origen: no la hay (network.spec), pero no se rompe por ello.
      }
    }
    return out
  })
}

test.describe('tokens de densidad', () => {
  test('pantalla alta (1440×900): densidad cómoda', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await gotoApp(page, '/')
    expect(await tokenValue(page, '--tz-row-h')).toBe('28px')
    expect(await tokenValue(page, '--tz-text-num-xl')).toBe('36px')
    expect(await tokenValue(page, '--tz-panel-pad')).toBe('16px')
  })

  test('pantalla baja (1280×800, iPad en horizontal): densidad compacta', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await gotoApp(page, '/')
    expect(await tokenValue(page, '--tz-row-h')).toBe('24px')
    expect(await tokenValue(page, '--tz-text-num-xl')).toBe('30px')
    expect(await tokenValue(page, '--tz-panel-pad')).toBe('12px')
  })

  test('la zona táctil mínima sigue al puntero: 44 px con puntero grueso, 32 px con ratón', async ({ page }) => {
    await gotoApp(page, '/')
    const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches)
    expect(await tokenValue(page, '--tz-hit-min')).toBe(coarse ? '44px' : '32px')
    const rules = await cssRules(page)
    expect(rules.some((r) => r.media?.includes('coarse') && /--tz-hit-min:\s*44px/.test(r.text))).toBe(true)
  })
})

test.describe('táctil', () => {
  test.use({ hasTouch: true })

  test('con puntero grueso, --tz-hit-min vale 44 px', async ({ page }) => {
    await gotoApp(page, '/')
    const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches)
    // La emulación táctil de Chromium marca el puntero como grueso; si algún día no lo hace, el test lo dice.
    test.skip(!coarse, 'esta emulación no informa de (pointer: coarse)')
    expect(await tokenValue(page, '--tz-hit-min')).toBe('44px')
  })
})

test.describe('tokens de movimiento', () => {
  test('con prefers-reduced-motion: sin duraciones, sin escalonado, sin desplazamiento y escala neutra', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await gotoApp(page, '/')
    for (const name of ['--tz-dur-fast', '--tz-dur-base', '--tz-dur-slow', '--tz-dur-camera', '--tz-dur-flash', '--tz-stagger']) {
      expect(ms(await tokenValue(page, name)), name).toBe(0)
    }
    expect(Number.parseFloat(await tokenValue(page, '--tz-shift'))).toBe(0)
    expect(Number.parseFloat(await tokenValue(page, '--tz-press-scale'))).toBe(1)

    await page.emulateMedia({ reducedMotion: 'no-preference' })
    expect(ms(await tokenValue(page, '--tz-stagger'))).toBeGreaterThan(0)
    expect(ms(await tokenValue(page, '--tz-dur-flash'))).toBeGreaterThan(0)
    expect(Number.parseFloat(await tokenValue(page, '--tz-shift'))).toBeGreaterThan(0)
    expect(Number.parseFloat(await tokenValue(page, '--tz-press-scale'))).toBeLessThan(1)
  })
})

test.describe('base.css', () => {
  test('clases comunes, acento de los controles nativos y animaciones tz-enter, tz-flash y tz-pulse', async ({ page }) => {
    await gotoApp(page, '/')
    const rules = await cssRules(page)
    const selectors = rules.flatMap((r) => (r.selector ? r.selector.split(',').map((s) => s.trim()) : []))
    for (const cls of ['.tz-panel', '.tz-panel__head', '.tz-panel-title', '.tz-num', '.tz-chip', '.tz-segmented', '.tz-iconbtn', '.tz-icon']) {
      expect(selectors, cls).toContain(cls)
    }
    const panel = rules.find((r) => r.selector === '.tz-panel')!
    expect(panel.text).toMatch(/accent-color/)
    const keyframes = rules.flatMap((r) => (r.keyframes ? [r.keyframes] : []))
    expect(keyframes).toEqual(expect.arrayContaining(['tz-enter', 'tz-flash', 'tz-pulse']))
  })

  test('los estados de hover comunes solo existen con (hover: hover): en táctil no se quedan pegados', async ({ page }) => {
    await gotoApp(page, '/')
    const rules = await cssRules(page)
    const hovers = rules.filter((r) => /^(a|\.tz-button|\.tz-iconbtn|\.tz-segmented > button):hover/.test(r.selector ?? ''))
    expect(hovers.length).toBeGreaterThanOrEqual(4)
    for (const r of hovers) expect(r.media, r.selector).toMatch(/hover:\s*hover/)
  })

  test('.tz-iconbtn: 32 px visibles; la zona táctil crece hasta --tz-hit-min sin mover el layout', async ({ page }) => {
    await gotoApp(page, '/')
    const probe = await page.evaluate(() => {
      const button = document.createElement('button')
      button.className = 'tz-iconbtn'
      button.setAttribute('aria-label', 'prueba')
      button.style.position = 'fixed'
      button.style.top = '200px'
      button.style.left = '200px'
      button.style.zIndex = '9999'
      document.body.append(button)
      const box = button.getBoundingClientRect()
      const hit = (dx: number) => document.elementFromPoint(box.left - dx, box.top + box.height / 2) === button
      const result: Record<string, boolean | number> = { width: box.width, height: box.height }
      button.style.setProperty('--tz-hit-min', '32px')
      result.outside32 = hit(5)
      button.style.setProperty('--tz-hit-min', '44px')
      result.outside44 = hit(5)
      result.far44 = hit(9)
      const after = button.getBoundingClientRect()
      result.sameBox = after.width === box.width && after.height === box.height && after.left === box.left
      button.remove()
      return result
    })
    expect(probe).toEqual({ width: 32, height: 32, outside32: false, outside44: true, far44: false, sameBox: true })
  })
})
