import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { duration, parseCssTime } from './motion'
import { token } from './tokens'

const APP = fileURLToPath(new URL('..', import.meta.url))
const TOKENS_CSS = readFileSync(join(APP, 'design/tokens.css'), 'utf8')

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

/** Sin comentarios: un ejemplo en un comentario no es una declaración. */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '')

/** Cuerpo de la primera regla `@media (<condición>) { :root { … } }` de tokens.css. */
function mediaRoot(condition: string): string {
  const at = TOKENS_CSS.indexOf(`@media (${condition})`)
  if (at < 0) return ''
  const open = TOKENS_CSS.indexOf(':root', at)
  return TOKENS_CSS.slice(open, TOKENS_CSS.indexOf('}', open))
}

const declared = (css: string, name: string) => new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(css)?.[1]?.trim()

/** #rrggbb → luminancia relativa (WCAG) y tono HSL en grados (null si es un gris). */
function rgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) throw new Error(`no es #rrggbb: ${hex}`)
  return [m[1]!, m[2]!, m[3]!].map((c) => Number.parseInt(c, 16) / 255) as [number, number, number]
}
function luminance(hex: string): number {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const [r, g, b] = rgb(hex).map(lin) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function hue(hex: string): number | null {
  const [r, g, b] = rgb(hex)
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  if (d < 0.08) return null
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return (h * 60 + 360) % 360
}
const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b))

describe('tokens de diseño', () => {
  it('un único fichero con color, espacio, tipografía, radios, capas y movimiento', () => {
    for (const prefix of ['--tz-bg', '--tz-space-', '--tz-text-', '--tz-font-', '--tz-radius-', '--tz-z-', '--tz-dur-', '--tz-ease-']) {
      expect(TOKENS_CSS, prefix).toContain(prefix)
    }
    const elsewhere = files(APP)
      .filter((f) => /\.(css|vue)$/.test(f) && !f.endsWith('tokens.css'))
      .filter((f) => /^\s*--tz-[\w-]+\s*:/m.test(readFileSync(f, 'utf8')))
    expect(elsewhere).toEqual([])
  })

  it('ningún color literal fuera de tokens.css (.vue, .ts y .css; three.js y uPlot los leen con token())', () => {
    const offenders: string[] = []
    for (const f of files(APP)) {
      if (!/\.(vue|ts|css)$/.test(f) || f.endsWith('.test.ts') || f.endsWith('tokens.css')) continue
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|(?:rgba?|hsla?)\(\s*\d/g)) offenders.push(`${relative(APP, f)}: ${m[0]}`)
    }
    expect(offenders).toEqual([])
  })

  it('el color de equipo nunca es color de texto (no llega a 4,5:1): solo franjas, bordes y tintes', () => {
    const offenders: string[] = []
    for (const f of files(APP)) {
      if (!/\.(vue|css)$/.test(f)) continue
      const src = stripComments(readFileSync(f, 'utf8'))
      for (const m of src.matchAll(/(?<![\w-])color\s*:[^;}{]*var\(\s*--team\b/g)) offenders.push(`${relative(APP, f)}: ${m[0]}`)
    }
    expect(offenders).toEqual([])
  })

  it('están todos los tokens de las propuestas 1–21 (Tanda 0)', () => {
    const expected = [
      // comparación y fantasma
      '--tz-compare-a', '--tz-compare-b', '--tz-ghost-opacity',
      // calor
      '--tz-heat-0', '--tz-heat-1', '--tz-heat-2', '--tz-heat-3', '--tz-heat-4', '--tz-heat-tie',
      // cronometraje
      '--tz-timing-best', '--tz-timing-personal', '--tz-timing-normal', '--tz-timing-none',
      // meteorología
      '--tz-rain', '--tz-weather-temp',
      // estelas
      '--tz-trail-slow', '--tz-trail-mid', '--tz-trail-fast', '--tz-trail-nodata',
      // clasificación
      '--tz-gain', '--tz-loss', '--tz-dur-flash', '--tz-best',
      // ambiente
      '--tz-sky-day-zenith', '--tz-sky-day-horizon', '--tz-sky-dusk-zenith', '--tz-sky-dusk-horizon',
      '--tz-sky-night-zenith', '--tz-sky-night-horizon', '--tz-fog', '--tz-track-night-tint',
      // DRS
      '--tz-drs',
      // iconos
      '--tz-icon-sm', '--tz-icon-md', '--tz-icon-lg', '--tz-icon-stroke',
      // paneles, densidad y cifras
      '--tz-space-0-5', '--tz-panel-w', '--tz-panel-w-narrow', '--tz-panel-pad', '--tz-panel-gap', '--tz-row-h',
      '--tz-hit-min', '--tz-text-num-md', '--tz-text-num-lg', '--tz-text-num-xl', '--tz-tracking-caps',
      '--tz-tracking-mono', '--tz-tracking-num', '--tz-leading-none', '--tz-team-tint', '--tz-chart-h',
      '--tz-accent-soft-hover',
      // movimiento
      '--tz-stagger', '--tz-shift', '--tz-press-scale',
    ]
    for (const name of expected) expect(() => token(name as `--tz-${string}`), name).not.toThrow()
  })

  it('densidad: compacta en pantallas bajas y zonas táctiles de 44 px con puntero grueso', () => {
    const low = mediaRoot('max-height: 860px')
    expect(declared(low, '--tz-panel-pad')).toBe('var(--tz-space-3)')
    expect(declared(low, '--tz-row-h')).toBe('24px')
    expect(declared(low, '--tz-text-num-xl')).toBe('30px')
    expect(declared(low, '--tz-chart-h')).toBe('54px')
    expect(declared(mediaRoot('pointer: coarse'), '--tz-hit-min')).toBe('44px')
    // Fuera de las media queries, los valores cómodos.
    expect(token('--tz-panel-pad')).toBe('16px')
    expect(token('--tz-row-h')).toBe('28px')
    expect(token('--tz-chart-h')).toBe('64px')
    expect(token('--tz-hit-min')).toBe('32px')
  })

  it('mapa de calor seguro para daltónicos: luminosidad estrictamente creciente', () => {
    const ramp = [0, 1, 2, 3, 4].map((i) => luminance(token(`--tz-heat-${i}`)))
    for (let i = 1; i < ramp.length; i++) expect(ramp[i]!, `--tz-heat-${i}`).toBeGreaterThan(ramp[i - 1]! * 1.25)
  })

  it('lo que se pinta sobre la pista no usa los tonos de bandera (rojo, amarillo, verde, SC, VSC)', () => {
    const flags = ['--tz-flag-green', '--tz-flag-yellow', '--tz-flag-double-yellow', '--tz-flag-red', '--tz-sc', '--tz-vsc']
      .map((name) => hue(token(name as `--tz-${string}`))!)
    const onTrack = [
      '--tz-heat-0', '--tz-heat-1', '--tz-heat-2', '--tz-heat-3', '--tz-heat-4',
      '--tz-trail-slow', '--tz-trail-mid', '--tz-trail-fast', '--tz-drs', '--tz-compare-a', '--tz-compare-b',
    ]
    for (const name of onTrack) {
      const h = hue(token(name as `--tz-${string}`))
      if (h === null) continue
      for (const f of flags) expect(hueGap(h, f), `${name} frente a una bandera`).toBeGreaterThanOrEqual(25)
    }
  })

  it('sin documento, token() devuelve el valor de :root (no el de reduced motion ni el de una media query)', () => {
    expect(token('--tz-sc')).toMatch(/^#[0-9a-f]{6}$/i)
    expect(token('--tz-dur-camera')).toBe('900ms')
    expect(duration('camera')).toBe(0.9)
    expect(() => token('--tz-no-existe')).toThrow()
  })

  it('un alias (var(--tz-…)) se resuelve al valor del token al que apunta', () => {
    expect(token('--tz-gain')).toBe(token('--tz-success'))
    expect(token('--tz-loss')).toBe(token('--tz-danger'))
    expect(token('--tz-best')).toBe(token('--tz-timing-best'))
    expect(token('--tz-panel-gap')).toBe('12px')
  })

  it('duraciones en ms o en s (el CSS minificado escribe 900ms como .9s)', () => {
    expect(parseCssTime('900ms')).toBe(0.9)
    expect(parseCssTime('.9s')).toBe(0.9)
    expect(parseCssTime('0ms')).toBe(0)
    expect(() => parseCssTime('rápido')).toThrow()
  })
})
