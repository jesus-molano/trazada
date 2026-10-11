/**
 * Diferencia en vivo entre el coche A y la vuelta de referencia del coche B, a la misma distancia recorrida dentro
 * de la vuelta (ítem 1, D31; TS puro, sin Vue ni three).
 *
 * Es una estimación (`lapDelta` en engine/estimated.ts): sale de las posiciones GPS de los dos coches (la `s` del
 * replay), no del cronometraje. El inicio de vuelta del cronometraje cae sobre la línea del GPS con unos ±8 m, así
 * que la cifra se da en décimas (`DELTA_STEP_MS`). La diferencia exacta es la oficial, con los tiempos de vuelta, al
 * cerrarse la vuelta (`OfficialDiff` en ./session.ts).
 *
 * delta = (tiempo de vuelta de A) − (tiempo de vuelta de B) a la misma distancia d: positivo, A va más lento.
 *
 * Solo con lo que ya había pasado en el instante t (sin el futuro): si B aún no había llegado a la distancia de A
 * (misma vuelta, B por detrás), se compara en la distancia de B, la última que ya habían recorrido los dos. Dentro de
 * un hueco de posición (más de 2 s sin señal o «sin dato») no se sabe cuándo pasó el coche por ahí: sin dato.
 */
import { type CarSample, type CarTrack, newCarSample, PATH_PIT, sampleCar } from '../replay/motion'
import { sAt, timeAtS } from './distance'

/** Resolución de la diferencia en vivo (ms): el GPS tiene un margen de unos ±8 m (≈ ±0,1 s a velocidad de carrera). */
export const DELTA_STEP_MS = 100

/** Inicio de una vuelta: instante (ms de sesión) y distancia acumulada del coche en ese instante (m). */
export interface LapAnchor {
  t: number
  s: number
}

/** Inicio de la vuelta de referencia y su paso por meta (ms de sesión; NaN si sigue abierta). */
export interface RefAnchor extends LapAnchor {
  end: number
}

/**
 * - `ok`: diferencia en `ms`.
 * - `pit`: A está en el pit lane (la diferencia no aplica: «en boxes»).
 * - `noData`: falta la posición de uno de los dos en esa distancia (hueco, fuera de sus datos).
 */
export type DeltaState = 'ok' | 'pit' | 'noData'

export interface LapDelta {
  state: DeltaState
  /** Tiempo de vuelta de A − el de B a la misma distancia (ms; positivo, A más lento). NaN si no es `ok`. */
  ms: number
  /** Distancia de A dentro de su vuelta en t (m); NaN sin posición. */
  dA: number
  /** Distancia (m) en la que se comparan: la de A o, si B aún no había llegado ahí, la de B. NaN si no es `ok`. */
  at: number
}

export function newLapDelta(): LapDelta {
  return { state: 'noData', ms: Number.NaN, dA: Number.NaN, at: Number.NaN }
}

/** Redondeo a la resolución de la diferencia en vivo (décimas). */
export function roundDelta(ms: number): number {
  const r = Math.round(ms / DELTA_STEP_MS) * DELTA_STEP_MS
  return r === 0 ? 0 : r
}

const scratchA = newCarSample()
const scratchB = newCarSample()

/**
 * Diferencia en vivo en t entre A (en la vuelta que empezó en `a`) y B (en su vuelta de referencia `b`). `trackA` y
 * `trackB` son las pistas de movimiento de cada coche (pueden ser la misma si se compara un coche consigo mismo).
 */
export function lapDelta(
  trackA: CarTrack,
  a: LapAnchor,
  trackB: CarTrack,
  b: RefAnchor,
  t: number,
  out: LapDelta = newLapDelta(),
  sample: CarSample = scratchA,
): LapDelta {
  out.state = 'noData'
  out.ms = Number.NaN
  out.dA = Number.NaN
  out.at = Number.NaN
  const smp = sampleCar(trackA, t, sample)
  if (smp.state === 'hidden') return out
  const dA = smp.s - a.s
  out.dA = dA
  if (smp.path === PATH_PIT) {
    out.state = 'pit'
    return out
  }
  if (!(dA >= 0) || !Number.isFinite(b.s)) return out
  // Hasta cuándo vale la vuelta de B: su paso por meta si ya la cerró; si no, ahora.
  const limit = Number.isNaN(b.end) || b.end > t ? t : b.end
  const tB = timeAtS(trackB, b.s + dA)
  if (tB !== null && tB <= limit) {
    out.state = 'ok'
    out.at = dA
    out.ms = t - a.t - (tB - b.t)
    return out
  }
  // B no había llegado a esa distancia en su vuelta (va por detrás en la misma vuelta, o A ya ha pasado el punto en el
  // que B cerró la suya): se compara en la última distancia de B, la que tenía en `limit`.
  const sB = sAt(trackB, limit, scratchB)
  if (sB === null) return out
  const at = sB - b.s
  if (!(at >= 0) || at > dA) return out
  const tA = timeAtS(trackA, a.s + at)
  if (tA === null || tA > t) return out
  out.state = 'ok'
  out.at = at
  out.ms = tA - a.t - (limit - b.t)
  return out
}
