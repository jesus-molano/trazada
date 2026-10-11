import { describe, expect, it } from 'vitest'
import { token } from '../../design/tokens'
import {
  ambienceLook,
  type AmbiencePalette,
  ambiencePalette,
  ambienceSource,
  backdropColor,
  DAY_MIN_DEG,
  FOG_MAX,
  fogRange,
  NIGHT_MAX_DEG,
  NIGHT_TINT_MAX,
  mixRgb,
  parseHex,
  phaseOf,
  phaseWeights,
  quantizeSun,
  type Rgb,
  sunAt,
} from './ambience'

const PALETTE = ambiencePalette(token)!
const smoothstep = (a: number, b: number, x: number) => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return u * u * (3 - 2 * u)
}
const dist = (a: Rgb, b: Rgb) => Math.max(...a.map((v, i) => Math.abs(v - b[i]!)))

describe('fases del ambiente', () => {
  it('día por encima de 6°, noche por debajo de −6° y crepúsculo entre medias', () => {
    expect(phaseOf(60)).toBe('day')
    expect(phaseOf(DAY_MIN_DEG)).toBe('day')
    expect(phaseOf(5.99)).toBe('dusk')
    expect(phaseOf(0)).toBe('dusk')
    expect(phaseOf(NIGHT_MAX_DEG)).toBe('dusk')
    expect(phaseOf(-6.01)).toBe('night')
    expect(phaseOf(-40)).toBe('night')
  })

  it('pesos continuos que suman 1: crepúsculo puro con el sol en el horizonte', () => {
    expect(phaseWeights(30)).toEqual({ day: 1, dusk: 0, night: 0 })
    expect(phaseWeights(0)).toEqual({ day: 0, dusk: 1, night: 0 })
    expect(phaseWeights(-30)).toEqual({ day: 0, dusk: 0, night: 1 })
    let prev = phaseWeights(-15)
    for (let s = -15; s <= 15; s += 0.05) {
      const w = phaseWeights(s)
      expect(w.day + w.dusk + w.night).toBeCloseTo(1, 12)
      // Sin saltos al cruzar un umbral: un paso de 0,05° mueve cada peso muy poco.
      expect(Math.abs(w.day - prev.day) + Math.abs(w.dusk - prev.dusk) + Math.abs(w.night - prev.night)).toBeLessThan(0.05)
      prev = w
    }
  })

  it('los colores del cielo son los de los tokens en cada fase y se mezclan sin saltos entre ellas', () => {
    expect(ambienceLook(40, PALETTE).zenith).toEqual(PALETTE.day.zenith)
    expect(ambienceLook(40, PALETTE).horizon).toEqual(PALETTE.day.horizon)
    expect(ambienceLook(0, PALETTE).horizon).toEqual(PALETTE.dusk.horizon)
    expect(ambienceLook(-20, PALETTE).zenith).toEqual(PALETTE.night.zenith)
    let prev = ambienceLook(-12, PALETTE)
    for (let s = -12; s <= 12; s += 0.25) {
      const look = ambienceLook(s, PALETTE)
      expect(dist(look.horizon, prev.horizon)).toBeLessThan(0.03)
      expect(dist(look.zenith, prev.zenith)).toBeLessThan(0.03)
      prev = look
    }
  })

  it('tono nocturno de la pista: nada de día ni con el sol sobre el horizonte; el máximo de noche cerrada', () => {
    expect(ambienceLook(30, PALETTE).trackTint).toBe(0)
    expect(ambienceLook(0, PALETTE).trackTint).toBe(0)
    expect(ambienceLook(-3, PALETTE).trackTint).toBeCloseTo(NIGHT_TINT_MAX * (1 - smoothstep(-6, 0, -3)), 12)
    expect(ambienceLook(-20, PALETTE).trackTint).toBe(NIGHT_TINT_MAX)
  })

  it('pasos de sol de 0,25°: el ambiente no cambia en cada frame', () => {
    expect(quantizeSun(12.1)).toBe(12)
    expect(quantizeSun(12.13)).toBe(12.25)
    expect(quantizeSun(-5.9)).toBe(-6)
  })
})

describe('fondo y niebla', () => {
  const look = ambienceLook(30, PALETTE)

  it('degradado por la altura de la vista: horizonte a 0°, cénit arriba, «suelo» abajo', () => {
    expect(dist(backdropColor(look, 0), look.horizon)).toBeLessThan(1e-12)
    expect(dist(backdropColor(look, 90), look.zenith)).toBeLessThan(1e-12)
    expect(dist(backdropColor(look, -90), look.nadir)).toBeLessThan(1e-12)
    expect(look.nadir).toEqual(mixRgb(PALETTE.ground, look.zenith, 0.35))
    // Monótono: cuanto más abajo, más cerca del suelo.
    let prev = Number.POSITIVE_INFINITY
    for (let e = 0; e >= -90; e -= 5) {
      const d = dist(backdropColor(look, e), look.nadir)
      expect(d).toBeLessThanOrEqual(prev + 1e-12)
      prev = d
    }
  })

  it('la niebla vale 0 en la parte más cercana de la pista y el tope en la más lejana (smoothstep de three.js)', () => {
    for (const [near, far] of [
      [300, 2600],
      [5, 4000],
      [1200, 1300],
    ] as const) {
      const r = fogRange(near, far)!
      expect(smoothstep(r.near, r.far, near)).toBe(0)
      expect(smoothstep(r.near, r.far, far)).toBeCloseTo(FOG_MAX, 6)
      expect(smoothstep(r.near, r.far, (near + far) / 2)).toBeLessThan(FOG_MAX)
    }
    expect(fogRange(100, 100)).toBeNull()
    expect(fogRange(100, 50)).toBeNull()
    expect(fogRange(Number.NaN, 50)).toBeNull()
    expect(fogRange(0, 100, 0)).toBeNull()
  })
})

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const toSrgb = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)

/** Contraste WCAG entre dos colores sRGB 0…1. */
function contrast(a: Rgb, b: Rgb): number {
  const lum = (c: Rgb) => 0.2126 * toLinear(c[0]) + 0.7152 * toLinear(c[1]) + 0.0722 * toLinear(c[2])
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number]
  return (x + 0.05) / (y + 0.05)
}

/**
 * Lo que pinta three.js (r186) con un material de la pista: tone mapping ACES Filmic (el de TresCanvas por defecto; el
 * cielo y el color de borrado no lo llevan), salida en sRGB y, después, la niebla, que se mezcla ya en sRGB
 * (`fog_fragment` va tras `colorspace_fragment`, con el color de la niebla en el espacio de salida).
 */
function onScreen(c: Rgb, fog: Rgb, k: number): Rgb {
  const mul = (m: number[][], v: number[]) => m.map((row) => row[0]! * v[0]! + row[1]! * v[1]! + row[2]! * v[2]!)
  const IN = [
    [0.59719, 0.35458, 0.04823],
    [0.076, 0.90834, 0.01566],
    [0.0284, 0.13383, 0.83777],
  ]
  const OUT = [
    [1.60475, -0.53108, -0.07367],
    [-0.10208, 1.10813, -0.00605],
    [-0.00327, -0.07276, 1.07602],
  ]
  const fit = (v: number) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081)
  const mapped = mul(OUT, mul(IN, c.map((v) => toLinear(v) / 0.6)).map(fit)).map((v) => toSrgb(Math.min(1, Math.max(0, v))))
  return [0, 1, 2].map((i) => mapped[i]! + (fog[i]! - mapped[i]!) * k) as unknown as Rgb
}

describe('legibilidad con los tokens: la pista lejana se distingue del fondo que tiene detrás', () => {
  const track = (name: `--tz-${string}`) => parseHex(token(name))!
  // La vista general mira 55° hacia abajo con 35° de campo: lo más alto del lienzo, a unos −37°.
  const OVERVIEW_TOP_DEG = -37

  it('bordes ≥ 3:1 (WCAG 1.4.11) y las partes altas de la cinta separadas del fondo, con la niebla al máximo, de día, al atardecer y de noche', () => {
    for (let sun = -15; sun <= 30; sun += 0.5) {
      const look = ambienceLook(sun, PALETTE)
      const shown = (c: Rgb) => onScreen(mixRgb(c, look.nightTint, look.trackTint), look.fog, FOG_MAX)
      for (let e = OVERVIEW_TOP_DEG; e >= -90; e -= 1) {
        const back = backdropColor(look, e)
        const where = `sol ${sun}°, vista ${e}°`
        expect(contrast(shown(track('--tz-track-edge')), back), where).toBeGreaterThanOrEqual(3)
        expect(contrast(shown(track('--tz-track-high')), back), where).toBeGreaterThanOrEqual(1.4)
      }
    }
  })

  it('sin ambiente, el modelo da lo de siempre: bordes a más de 4:1 del fondo liso (referencia del test de arriba)', () => {
    const bg = PALETTE.ground
    expect(contrast(onScreen(track('--tz-track-edge'), PALETTE.fog, 0), bg)).toBeGreaterThan(4)
    // La parte baja de la cinta ya está casi al nivel del fondo: lo que dibuja la pista son sus bordes.
    expect(contrast(onScreen(track('--tz-track-low'), PALETTE.fog, 0), bg)).toBeLessThan(1.1)
  })
})

describe('fuente del ambiente', () => {
  const SPA = { lat: 50.44, lon: 5.97 }

  it('altura del sol con el t0 UTC de la sesión y el reloj maestro', () => {
    const src = ambienceSource('2026-07-17T11:16:23.172Z', SPA)
    expect(src.status).toBe('ok')
    // Inicio del extracto de Spa (4 230 000 ms de sesión): 12:27 UTC, sol alto.
    expect(sunAt(src, 4_230_000)!).toBeGreaterThan(55)
  })

  it('sin posición del circuito o sin hora válida, no hay sol (escena neutra)', () => {
    const noPlace = ambienceSource('2026-07-17T11:16:23.172Z', null)
    expect(noPlace.status).toBe('no-location')
    expect(sunAt(noPlace, 0)).toBeNull()
    const noTime = ambienceSource('no es una fecha', SPA)
    expect(noTime.status).toBe('no-time')
    expect(sunAt(noTime, 0)).toBeNull()
    expect(sunAt(ambienceSource('2026-07-17T11:16:23.172Z', SPA), Number.NaN)).toBeNull()
  })

  it('paleta de los tokens; un token que no sea #rrggbb deja la escena sin ambiente (null), nunca a medias', () => {
    const p = ambiencePalette(token) as AmbiencePalette
    expect(p.day.zenith).toEqual(parseHex(token('--tz-sky-day-zenith')))
    expect(p.ground).toEqual(parseHex(token('--tz-scene-bg')))
    expect(ambiencePalette((name) => (name === '--tz-fog' ? 'var(--x)' : token(name)))).toBeNull()
    expect(parseHex('#0A0c0F')).toEqual([10 / 255, 12 / 255, 15 / 255])
    expect(parseHex('rojo')).toBeNull()
  })
})
