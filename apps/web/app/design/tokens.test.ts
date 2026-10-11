import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { duration, parseCssTime } from './motion'
import { token } from './tokens'

const APP = fileURLToPath(new URL('..', import.meta.url))
/** Ruta relativa con «/» (en Windows, `relative` usa «\»). */
const posix = (path: string) => path.split(sep).join('/')
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

/** #rrggbb → OKLab (Björn Ottosson): distancia perceptual entre dos colores. */
function oklab(hex: string): [number, number, number] {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const [r, g, b] = rgb(hex).map(lin) as [number, number, number]
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}
const deltaE = (a: string, b: string) => Math.hypot(...oklab(a).map((v, i) => v - oklab(b)[i]!))

/** OKLab → luminancia relativa (WCAG) de ese color en sRGB, recortado a la gama (como lo pinta el navegador). */
function mixedLuminance([L, a, b]: [number, number, number]): number {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const clip = (c: number) => Math.min(1, Math.max(0, c))
  const r = clip(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)
  const g = clip(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)
  const bl = clip(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl
}

/** Ficheros de la app (sin tests ni tokens.css) cuyo código usa un token, y no solo lo nombra en un comentario. */
function usersOf(token: string, exts = /\.(vue|ts|css)$/): string[] {
  const use = new RegExp(`var\\(\\s*${token}(?:-[\\w-]+)?\\s*\\)|['"\`]${token}(?:-[\\w-]+)?['"\`]`)
  return files(APP)
    .filter((f) => exts.test(f) && !f.endsWith('.test.ts') && !f.endsWith('tokens.css'))
    .filter((f) => use.test(stripComments(readFileSync(f, 'utf8'))))
    .map((f) => posix(relative(APP, f)))
    .sort()
}

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
      for (const m of src.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|(?:rgba?|hsla?)\(\s*\d/g)) offenders.push(`${posix(relative(APP, f))}: ${m[0]}`)
    }
    expect(offenders).toEqual([])
  })

  it('el color de equipo nunca es color de texto (no llega a 4,5:1): solo franjas, bordes y tintes', () => {
    const offenders: string[] = []
    for (const f of files(APP)) {
      if (!/\.(vue|css)$/.test(f)) continue
      const src = stripComments(readFileSync(f, 'utf8'))
      for (const m of src.matchAll(/(?<![\w-])color\s*:[^;}{]*var\(\s*--team\b/g)) offenders.push(`${posix(relative(APP, f))}: ${m[0]}`)
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
      // DRS
      '--tz-drs',
      // radio de los equipos
      '--tz-radio',
      // iconos
      '--tz-icon-sm', '--tz-icon-md', '--tz-icon-lg', '--tz-icon-stroke',
      // paneles, densidad y cifras
      '--tz-space-0-5', '--tz-panel-w', '--tz-panel-w-narrow', '--tz-panel-pad', '--tz-panel-gap', '--tz-row-h',
      '--tz-hit-min', '--tz-text-num-md', '--tz-text-num-lg', '--tz-text-num-xl', '--tz-tracking-caps',
      '--tz-tracking-mono', '--tz-tracking-num', '--tz-leading-none', '--tz-team-tint', '--tz-chart-h',
      '--tz-accent-soft-hover',
      // movimiento
      '--tz-stagger', '--tz-shift', '--tz-press-scale',
      // identidad «Asfalto y pintura» (D47)
      '--tz-paint', '--tz-paint-strong', '--tz-accent-on', '--tz-link-line', '--tz-signal', '--tz-kerb', '--tz-grain',
      '--tz-font-display', '--tz-tracking-display',
    ]
    for (const name of expected) expect(() => token(name as `--tz-${string}`), name).not.toThrow()
  })

  it('el piano (kerb) solo bajo la marca y en la pestaña activa del análisis: no se extiende como disfraz (D47)', () => {
    // La marca está en la cabecera de la portada (layouts/default.vue) y en la del replay (TzBrandBar, D44). En cada
    // fichero, una sola regla: la franja bajo la marca o el borde de la pestaña elegida. Ni más ficheros ni más reglas.
    const KERB_RULES: Record<string, string[]> = {
      'components/TzBrandBar.vue': ['.tz-brandbar__brand::after'],
      'components/replay-overlays/TzAnalysis.vue': [".tz-analysis__tab[aria-selected='true']"],
      'layouts/default.vue': ['.tz-header::after'],
    }
    expect(usersOf('--tz-kerb')).toEqual(Object.keys(KERB_RULES).sort())
    for (const [file, selectors] of Object.entries(KERB_RULES)) {
      const style = /<style[^>]*>([\s\S]*?)<\/style>/.exec(stripComments(readFileSync(join(APP, file), 'utf8')))?.[1] ?? ''
      // Reglas sin anidar (las de dentro de un @media también salen, con su selector).
      const rules = [...style.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .filter((m) => /var\(\s*--tz-kerb/.test(m[2]!))
        .map((m) => m[1]!.trim())
      expect(rules, file).toEqual(selectors)
    }
  })

  it('el color de señal solo en tokens.css y base.css: foco, selección de texto y traza de velocidad (D47)', () => {
    expect(usersOf('--tz-signal')).toEqual(['design/base.css'])
    expect(declared(TOKENS_CSS, '--tz-focus')).toBe('var(--tz-signal)')
    expect(declared(TOKENS_CSS, '--tz-chart-speed')).toBe('var(--tz-signal)')
  })

  it('«Estimado» se distingue del morado de mejor vuelta y del de boxes (ΔE OKLab ≥ 0,08)', () => {
    const estimated = token('--tz-estimated')
    for (const other of ['--tz-timing-best', '--tz-pit'] as const) {
      expect(deltaE(estimated, token(other)), other).toBeGreaterThanOrEqual(0.08)
    }
  })

  it('ningún backdrop-filter en .vue ni .css: desenfocar un lienzo animado cuesta en cada frame', () => {
    const offenders = files(APP)
      .filter((f) => /\.(vue|css)$/.test(f))
      .filter((f) => /(?<![\w-])backdrop-filter\s*:/.test(stripComments(readFileSync(f, 'utf8'))))
      .map((f) => posix(relative(APP, f)))
    expect(offenders).toEqual([])
  })

  it('placa maciza = activado: el texto sobre la pintura usa --tz-accent-on y se lee (≥ 4,5:1)', () => {
    const contrast = (a: string, b: string) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
      return (hi + 0.05) / (lo + 0.05)
    }
    expect(token('--tz-accent')).toBe(token('--tz-paint'))
    expect(contrast(token('--tz-accent-on'), token('--tz-accent'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(token('--tz-accent-on'), token('--tz-accent-strong'))).toBeGreaterThanOrEqual(4.5)
  })

  it('sobre el tinte de equipo de la fila elegida (el más claro, el de un equipo blanco), el texto y el atenuado se leen (≥ 4,5:1); el tenue, no', () => {
    // color-mix(in oklab, <equipo> --tz-team-tint, --tz-surface-2), como `.is-selected .tz-lb__btn` (TzLeaderboard).
    const tint = Number.parseFloat(token('--tz-team-tint')) / 100
    const mixed = oklab('#ffffff').map((v, i) => tint * v + (1 - tint) * oklab(token('--tz-surface-2'))[i]!) as [number, number, number]
    const lum = mixedLuminance(mixed)
    const contrast = (hex: string) => {
      const [hi, lo] = [luminance(hex), lum].sort((x, y) => y - x) as [number, number]
      return (hi + 0.05) / (lo + 0.05)
    }
    expect(contrast(token('--tz-text'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(token('--tz-text-muted'))).toBeGreaterThanOrEqual(4.5)
    // El tenue solo va sobre superficies lisas: en la fila elegida, «sin señal» y las celdas sin dato van atenuadas.
    expect(contrast(token('--tz-text-faint'))).toBeLessThan(4.5)
    const leaderboard = readFileSync(join(APP, 'components/TzLeaderboard.vue'), 'utf8')
    expect(leaderboard).toMatch(/\.is-selected\.is-nosignal \.tz-lb__tla,[\s\S]*?\{\s*color: var\(--tz-text-muted\);/)
  })

  it('densidad: compacta en pantallas bajas y zonas táctiles de 44 px con puntero grueso', () => {
    const low = mediaRoot('max-height: 860px')
    expect(declared(low, '--tz-panel-pad')).toBe('var(--tz-space-3)')
    expect(declared(low, '--tz-row-h')).toBe('24px')
    expect(declared(low, '--tz-text-num-xl')).toBe('50px')
    expect(declared(low, '--tz-chart-h')).toBe('54px')
    expect(declared(low, '--tz-chart-h-tall')).toBe('80px')
    expect(declared(mediaRoot('pointer: coarse'), '--tz-hit-min')).toBe('44px')
    // Fuera de las media queries, los valores cómodos.
    expect(token('--tz-panel-pad')).toBe('16px')
    expect(token('--tz-row-h')).toBe('28px')
    expect(token('--tz-chart-h')).toBe('64px')
    expect(token('--tz-hit-min')).toBe('32px')
  })

  it('diseños del replay (ítem 15): columna ancha y gráficas altas de «Análisis», y la zona de agarre de las asas', () => {
    const px = (name: `--tz-${string}`) => Number.parseFloat(token(name))
    expect(px('--tz-panel-w-wide')).toBeGreaterThan(px('--tz-panel-w'))
    expect(px('--tz-chart-h-tall')).toBeGreaterThan(px('--tz-chart-h'))
    expect(px('--tz-resize-hit')).toBeGreaterThanOrEqual(24)
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
