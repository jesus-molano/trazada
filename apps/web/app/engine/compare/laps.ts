/**
 * Inicio de cada vuelta de cada coche en tiempo y en distancia (TS puro, sin Vue ni three): la base para
 * comparar a dos coches por distancia dentro de una vuelta (delta, trazas, fantasma, minisectores).
 *
 * - Tiempo (`t`): el inicio oficial de la vuelta (`startMs`). Si falta, el paso por meta real de la vuelta
 *   anterior y, si tampoco está, el fin menos el tiempo oficial. Sin nada de eso, la vuelta no entra (sin dato).
 *   Los inicios quedan estrictamente crecientes: uno que no avanza respecto al anterior no entra.
 * - Distancia (`s`): la distancia acumulada del coche en ese instante, la del replay (posición GPS proyectada,
 *   ±8 m). NaN si en ese instante no hay posición (hueco o «sin dato»): no se inventa.
 * - Fin (`end`): el paso por meta real que cierra la vuelta; NaN si no lo hay.
 */
import type { CarLaps, LapTable } from '../analysis/lapTable'
import { newCarSample, type CarTrack } from '../replay/motion'
import { sAt } from './distance'

export interface LapStarts {
  car: string
  /** Número de vuelta. */
  lap: Int32Array
  /** Inicio (ms de sesión), estrictamente creciente. */
  t: Float64Array
  /** Distancia acumulada (m) del coche al empezar la vuelta; NaN sin posición en ese instante. */
  s: Float64Array
  /** Paso por meta real que cierra la vuelta (ms de sesión); NaN si no lo hay. */
  end: Float64Array
}

/** Inicio de la vuelta k (ms de sesión) según el cronometraje, o null si no se sabe. */
export function lapStartTime(laps: CarLaps, k: number): number | null {
  const start = laps.startMs[k]!
  if (start >= 0) return start
  if (k > 0 && laps.lap[k - 1] === laps.lap[k]! - 1 && laps.crossMs[k - 1]! > 0) return laps.crossMs[k - 1]!
  const end = laps.endMs[k]!
  const ms = laps.lapMs[k]!
  if (end > 0 && ms > 0 && end - ms >= 0) return end - ms
  return null
}

/** Inicios de vuelta de un coche. Sin pista de movimiento, todas las distancias son NaN. */
export function carLapStarts(laps: CarLaps, track: CarTrack | null): LapStarts {
  const lap: number[] = []
  const t: number[] = []
  const s: number[] = []
  const end: number[] = []
  const sample = newCarSample()
  for (let k = 0; k < laps.lap.length; k++) {
    const start = lapStartTime(laps, k)
    if (start === null || (t.length > 0 && start <= t[t.length - 1]!)) continue
    lap.push(laps.lap[k]!)
    t.push(start)
    s.push((track && sAt(track, start, sample)) ?? NaN)
    end.push(laps.crossMs[k]! > 0 ? laps.crossMs[k]! : NaN)
  }
  return {
    car: laps.car,
    lap: Int32Array.from(lap),
    t: Float64Array.from(t),
    s: Float64Array.from(s),
    end: Float64Array.from(end),
  }
}

/** Inicios de vuelta de todos los coches de la tabla (con su pista de movimiento, si la tienen). */
export function lapStartsByCar(table: LapTable, tracks: readonly CarTrack[]): Map<string, LapStarts> {
  const byCar = new Map(tracks.map((tr) => [tr.car, tr]))
  const out = new Map<string, LapStarts>()
  for (const [car, laps] of table.cars) out.set(car, carLapStarts(laps, byCar.get(car) ?? null))
  return out
}

/** Índice de la vuelta que había empezado en t (el último inicio ≤ t), o −1 antes de la primera. */
export function lapAtTime(starts: LapStarts, t: number): number {
  let lo = 0
  let hi = starts.t.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (starts.t[mid]! <= t) lo = mid + 1
    else hi = mid
  }
  return lo - 1
}

/**
 * Índice de la vuelta en la que estaba el coche al llegar a la distancia acumulada s (el último inicio con
 * distancia conocida ≤ s), o −1. Las vueltas cuyo inicio no tiene posición se saltan.
 */
export function lapAtS(starts: LapStarts, s: number): number {
  for (let k = starts.s.length - 1; k >= 0; k--) {
    const x = starts.s[k]!
    if (!Number.isNaN(x) && x <= s) return k
  }
  return -1
}

/** ¿Estaba el coche en la vuelta k en t (empezada y sin cerrar)? Sin paso por meta, sigue abierta. */
export function inLap(starts: LapStarts, k: number, t: number): boolean {
  if (k < 0 || k >= starts.t.length || t < starts.t[k]!) return false
  const end = starts.end[k]!
  return Number.isNaN(end) || t < end
}
