/**
 * Ambiente de la escena (ítem 10, D37): cielo, niebla de profundidad y tono nocturno de la pista según la altura del
 * sol en el circuito a esa hora. Es decorativo: posición del sol (cálculo astronómico con la hora UTC de la sesión y el
 * centro del circuito), no el tiempo atmosférico, que no está en los datos. Sin posición del circuito o sin hora, no
 * hay ambiente: la escena neutra de siempre («sin dato de ubicación»), nunca un cielo inventado.
 *
 * TS puro: los colores son tríos sRGB 0…1 (los de los tokens `--tz-sky-*`, `--tz-fog`, `--tz-track-night-tint` y
 * `--tz-scene-bg`) y se mezclan en sRGB, como un degradado CSS; la escena los convierte a lineal para three.js.
 *
 * Fases por la altura del sol: día por encima de 6°, crepúsculo entre −6° y 6° (el civil acaba a −6°) y noche por
 * debajo. Los colores se mezclan de forma continua entre fases (sin saltos al cruzar un umbral): el del crepúsculo
 * manda con el sol en el horizonte (0°).
 */
import { solarElevationDeg } from './sun'

/** Color sRGB, cada canal en 0…1. */
export type Rgb = readonly [number, number, number]

export interface SkyColors {
  readonly zenith: Rgb
  readonly horizon: Rgb
}

export interface AmbiencePalette {
  readonly day: SkyColors
  readonly dusk: SkyColors
  readonly night: SkyColors
  /** Fondo neutro de la escena (`--tz-scene-bg`): lo que se ve bajo el horizonte parte de él. */
  readonly ground: Rgb
  readonly fog: Rgb
  readonly nightTint: Rgb
}

export type AmbiencePhase = 'day' | 'dusk' | 'night'

/** Por encima, día; por debajo de `NIGHT_MAX_DEG`, noche; entre los dos, crepúsculo. */
export const DAY_MIN_DEG = 6
export const NIGHT_MAX_DEG = -6
/** Altura de la vista (°) a la que el cielo ya es el del cénit. */
export const ZENITH_SPAN_DEG = 50
/**
 * Bajo el horizonte (lo que hay detrás de la pista en la vista general, que mira hacia abajo), el brillo del horizonte
 * se apaga en estos grados hasta el «suelo»: el fondo neutro con un poco del color del cénit. Así el fondo detrás de la
 * pista sigue oscuro y la pista lejana se distingue (lo comprueba un test con los tokens).
 */
export const GROUND_SPAN_DEG = 45
export const GROUND_TINT = 0.35
/**
 * Niebla en el punto más lejano de la pista (la parte cercana, sin niebla). Con un 25 %, los bordes de la pista lejana
 * siguen a ≥ 3:1 del fondo en todas las fases (WCAG 1.4.11; lo comprueba un test con los tokens).
 */
export const FOG_MAX = 0.25
/** Mezcla máxima de la pista hacia `--tz-track-night-tint` de noche (focos): poca, para no apagar a los coches. */
export const NIGHT_TINT_MAX = 0.08
/** El ambiente cambia por pasos de sol de 0,25° (≈ 1 min de reloj): la escena solo recolorea al cambiar de paso. */
export const SUN_STEP_DEG = 0.25

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const smoothstep = (a: number, b: number, x: number) => {
  const u = clamp01((x - a) / (b - a))
  return u * u * (3 - 2 * u)
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

/** `#rrggbb` (un token de color) → sRGB 0…1; null si no tiene esa forma. */
export function parseHex(hex: string): Rgb | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim())
  return m ? [parseInt(m[1]!, 16) / 255, parseInt(m[2]!, 16) / 255, parseInt(m[3]!, 16) / 255] : null
}

/** Tokens de color del ambiente (`design/tokens.css`). */
export const AMBIENCE_TOKENS = {
  dayZenith: '--tz-sky-day-zenith',
  dayHorizon: '--tz-sky-day-horizon',
  duskZenith: '--tz-sky-dusk-zenith',
  duskHorizon: '--tz-sky-dusk-horizon',
  nightZenith: '--tz-sky-night-zenith',
  nightHorizon: '--tz-sky-night-horizon',
  ground: '--tz-scene-bg',
  fog: '--tz-fog',
  nightTint: '--tz-track-night-tint',
} as const

/** Paleta del ambiente leída con `read` (el `token()` de la escena); null si algún token no es un `#rrggbb`. */
export function ambiencePalette(read: (name: `--tz-${string}`) => string): AmbiencePalette | null {
  const c = {} as Record<keyof typeof AMBIENCE_TOKENS, Rgb>
  for (const [key, name] of Object.entries(AMBIENCE_TOKENS) as [keyof typeof AMBIENCE_TOKENS, `--tz-${string}`][]) {
    const rgb = parseHex(read(name))
    if (!rgb) return null
    c[key] = rgb
  }
  return {
    day: { zenith: c.dayZenith, horizon: c.dayHorizon },
    dusk: { zenith: c.duskZenith, horizon: c.duskHorizon },
    night: { zenith: c.nightZenith, horizon: c.nightHorizon },
    ground: c.ground,
    fog: c.fog,
    nightTint: c.nightTint,
  }
}

export function phaseOf(sunDeg: number): AmbiencePhase {
  if (sunDeg >= DAY_MIN_DEG) return 'day'
  return sunDeg < NIGHT_MAX_DEG ? 'night' : 'dusk'
}

export interface PhaseWeights {
  day: number
  dusk: number
  night: number
}

/** Peso de cada fase (suman 1), continuo con la altura del sol: crepúsculo puro a 0°, día ≥ 6°, noche ≤ −6°. */
export function phaseWeights(sunDeg: number): PhaseWeights {
  if (sunDeg >= 0) {
    const day = smoothstep(0, DAY_MIN_DEG, sunDeg)
    return { day, dusk: 1 - day, night: 0 }
  }
  const dusk = smoothstep(NIGHT_MAX_DEG, 0, sunDeg)
  return { day: 0, dusk, night: 1 - dusk }
}

/** Altura del sol redondeada al paso del ambiente. */
export const quantizeSun = (sunDeg: number) => Math.round(sunDeg / SUN_STEP_DEG) * SUN_STEP_DEG

/** Lo que pinta la escena para una altura del sol. */
export interface AmbienceLook {
  /** Altura del sol (°) con la que se calculó (ya redondeada al paso). */
  readonly sunDeg: number
  readonly phase: AmbiencePhase
  readonly weights: PhaseWeights
  readonly zenith: Rgb
  readonly horizon: Rgb
  /** Color de la vista mirando hacia abajo del todo. */
  readonly nadir: Rgb
  readonly fog: Rgb
  readonly nightTint: Rgb
  /** Mezcla de la pista hacia `nightTint` (0 de día; `NIGHT_TINT_MAX` de noche cerrada). */
  readonly trackTint: number
}

export function ambienceLook(sunDeg: number, palette: AmbiencePalette): AmbienceLook {
  const w = phaseWeights(sunDeg)
  const blend = (pick: (s: SkyColors) => Rgb): Rgb => {
    const d = pick(palette.day)
    const k = pick(palette.dusk)
    const n = pick(palette.night)
    const at = (i: 0 | 1 | 2) => d[i] * w.day + k[i] * w.dusk + n[i] * w.night
    return [at(0), at(1), at(2)]
  }
  const zenith = blend((s) => s.zenith)
  return {
    sunDeg,
    phase: phaseOf(sunDeg),
    weights: w,
    zenith,
    horizon: blend((s) => s.horizon),
    nadir: mixRgb(palette.ground, zenith, GROUND_TINT),
    fog: palette.fog,
    nightTint: palette.nightTint,
    trackTint: NIGHT_TINT_MAX * w.night,
  }
}

/**
 * Color del fondo en una dirección de la vista con altura `elevationDeg` (−90 mirando abajo, 90 al cénit): del
 * horizonte al cénit por encima y del horizonte al «suelo» por debajo. Solo depende de la altura: el mapa no está
 * orientado al norte, así que no hay acimut ni disco solar.
 */
export function backdropColor(look: AmbienceLook, elevationDeg: number): Rgb {
  if (elevationDeg >= 0) return mixRgb(look.horizon, look.zenith, smoothstep(0, ZENITH_SPAN_DEG, elevationDeg))
  return mixRgb(look.horizon, look.nadir, smoothstep(0, GROUND_SPAN_DEG, -elevationDeg))
}

/**
 * Niebla lineal de three.js (`smoothstep(near, far, profundidad)`) que vale 0 en la parte más cercana de la pista
 * (`nearDepth`) y `maxFog` en la más lejana (`farDepth`): así la parte lejana nunca pasa de ese tope, se mire como se
 * mire. null si no hay profundidad que cubrir (sin niebla).
 */
export function fogRange(nearDepth: number, farDepth: number, maxFog = FOG_MAX): { near: number; far: number } | null {
  if (!Number.isFinite(nearDepth) || !Number.isFinite(farDepth) || farDepth <= nearDepth || maxFog <= 0) return null
  // u en (0, 1] tal que smoothstep(u) = maxFog (bisección: es monótona).
  let lo = 0
  let hi = 1
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (mid * mid * (3 - 2 * mid) < Math.min(1, maxFog)) lo = mid
    else hi = mid
  }
  const u = Math.max(1e-6, (lo + hi) / 2)
  return { near: nearDepth, far: nearDepth + (farDepth - nearDepth) / u }
}

/** Por qué no hay ambiente: sin posición del circuito, o sin una hora UTC válida de la sesión. */
export type AmbienceStatus = 'ok' | 'no-location' | 'no-time'

export interface AmbienceSource {
  readonly status: AmbienceStatus
  /** Instante UTC (ms) del tiempo de sesión 0 (`manifest.session.t0Utc`). */
  readonly t0Ms: number
  readonly lat: number
  readonly lon: number
}

/** Fuente del ambiente de una sesión: su `t0Utc` y el centro de su circuito (null si no se sabe dónde está). */
export function ambienceSource(t0Utc: string, center: { lat: number; lon: number } | null): AmbienceSource {
  const t0Ms = Date.parse(t0Utc)
  if (!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lon)) {
    return { status: 'no-location', t0Ms, lat: Number.NaN, lon: Number.NaN }
  }
  if (!Number.isFinite(t0Ms)) return { status: 'no-time', t0Ms, lat: center.lat, lon: center.lon }
  return { status: 'ok', t0Ms, lat: center.lat, lon: center.lon }
}

/** Altura del sol (°) en el tiempo de sesión `sessionMs` (el del reloj maestro); null sin fuente válida. */
export function sunAt(source: AmbienceSource, sessionMs: number): number | null {
  if (source.status !== 'ok' || !Number.isFinite(sessionMs)) return null
  const deg = solarElevationDeg(source.t0Ms + sessionMs, source.lat, source.lon)
  return Number.isFinite(deg) ? deg : null
}
