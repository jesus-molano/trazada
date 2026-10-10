/**
 * Race trace (ítem 3, D33): diferencia con el primero en cada paso por meta, vuelta a vuelta, con los tiempos
 * oficiales de paso por la línea (`crossMs` del índice de vueltas: el fin de la vuelta del cronometraje, salvo un
 * registro residual que no es un paso por meta). Dato real: sin corrección de combustible ni suavizado.
 *
 * - El primero de la vuelta k es el primer coche que la completa: gap(coche, k) = paso(coche, k) − mín. de los
 *   pasos de la vuelta k. Un coche doblado completa su vuelta k más tarde, así que su gap puede ser mayor que una
 *   vuelta (es lo que pasó en la pista, no un error).
 * - Sin paso por meta (no completó la vuelta, retirado, registro residual) → NaN («sin dato»): la serie se corta,
 *   nunca se rellena.
 * - La vuelta 1 entra: aunque no tenga tiempo oficial, su paso por meta es real.
 * - Corte («Sin spoilers»): solo los pasos por meta hasta `cutoffMs`.
 *
 * TS puro (sin Vue ni three).
 */
import type { LapTable } from './lapTable'

export interface RaceTraceSeries {
  car: string
  /** Gap (ms) al primero en el paso por meta de cada vuelta de `RaceTrace.laps`; NaN sin paso por meta. */
  gapMs: Float64Array
  /** Última vuelta con paso por meta hasta el corte (0 ninguna). */
  lastLap: number
}

export interface RaceTrace {
  /** Vueltas 1…N: N es la última vuelta que alguien completó hasta el corte (0 vueltas: vacío). */
  laps: Int32Array
  /** Paso por meta del primero en cada vuelta (ms de sesión). */
  leaderMs: Float64Array
  /** Coche que completó primero cada vuelta. */
  leaderCar: readonly string[]
  /** Una serie por coche, en el orden del índice de vueltas. */
  series: readonly RaceTraceSeries[]
}

/** Paso por meta real de la vuelta k hasta el corte, o NaN. */
function crossing(crossMs: Float64Array, k: number, cutoffMs: number): number {
  const x = crossMs[k]!
  return x > 0 && x <= cutoffMs ? x : Number.NaN
}

export function raceTrace(table: LapTable, cutoffMs = Infinity): RaceTrace {
  let n = 0
  for (const c of table.cars.values()) {
    for (let k = 0; k < c.lap.length; k++) {
      if (!Number.isNaN(crossing(c.crossMs, k, cutoffMs)) && c.lap[k]! > n) n = c.lap[k]!
    }
  }
  const leaderMs = new Float64Array(n).fill(Number.NaN)
  const leaderCar: string[] = Array.from({ length: n }, () => '')
  for (const c of table.cars.values()) {
    for (let k = 0; k < c.lap.length; k++) {
      const lap = c.lap[k]!
      const x = crossing(c.crossMs, k, cutoffMs)
      if (lap < 1 || Number.isNaN(x)) continue
      const best = leaderMs[lap - 1]!
      if (Number.isNaN(best) || x < best) {
        leaderMs[lap - 1] = x
        leaderCar[lap - 1] = c.car
      }
    }
  }
  const series: RaceTraceSeries[] = []
  for (const c of table.cars.values()) {
    const gapMs = new Float64Array(n).fill(Number.NaN)
    let lastLap = 0
    for (let k = 0; k < c.lap.length; k++) {
      const lap = c.lap[k]!
      const x = crossing(c.crossMs, k, cutoffMs)
      // Con dos filas con el mismo número de vuelta, cuenta la primera (como `lapIndex`).
      if (lap < 1 || Number.isNaN(x) || !Number.isNaN(gapMs[lap - 1]!)) continue
      gapMs[lap - 1] = x - leaderMs[lap - 1]!
      if (lap > lastLap) lastLap = lap
    }
    series.push({ car: c.car, gapMs, lastLap })
  }
  return { laps: Int32Array.from({ length: n }, (_, i) => i + 1), leaderMs, leaderCar, series }
}

/**
 * Vuelta en curso del primero en t (para la línea del instante actual en las gráficas por vuelta): la siguiente a la
 * última que alguien completó, sin pasar de la última vuelta de la tabla; 1 si alguien ya empezó la primera y nadie
 * la completó; null antes de eso (o sin vueltas).
 */
export function leaderLapAt(table: LapTable, t: number): number | null {
  let done = 0
  let started = false
  let maxLap = 0
  for (const c of table.cars.values()) {
    for (let k = 0; k < c.lap.length; k++) {
      const lap = c.lap[k]!
      if (lap > maxLap) maxLap = lap
      if (c.crossMs[k]! > 0 && c.crossMs[k]! <= t && lap > done) done = lap
      if (c.startMs[k]! >= 0 && c.startMs[k]! <= t) started = true
    }
  }
  if (done > 0) return Math.min(done + 1, maxLap)
  return started && maxLap > 0 ? 1 : null
}

/**
 * Inicio de la vuelta `lap` para saltar a ella desde una gráfica por vuelta: el primer inicio oficial de esa vuelta
 * entre todos los coches; si no lo hay, el primer paso por meta de la vuelta anterior. null si no se sabe.
 */
export function lapStartMs(table: LapTable, lap: number): number | null {
  let start = Infinity
  let prevCross = Infinity
  for (const c of table.cars.values()) {
    for (let k = 0; k < c.lap.length; k++) {
      if (c.lap[k] === lap && c.startMs[k]! >= 0) start = Math.min(start, c.startMs[k]!)
      if (c.lap[k] === lap - 1 && c.crossMs[k]! > 0) prevCross = Math.min(prevCross, c.crossMs[k]!)
    }
  }
  if (start !== Infinity) return start
  return prevCross !== Infinity ? prevCross : null
}

/**
 * Instantes en los que cambia lo que muestra el race trace (todos los pasos por meta reales, ordenados). Con ellos,
 * la interfaz solo recalcula cuando el reloj cruza uno (no en cada actualización del reloj).
 */
export function crossingTimes(table: LapTable): Float64Array {
  const out: number[] = []
  for (const c of table.cars.values()) for (const x of c.crossMs) if (x > 0) out.push(x)
  return Float64Array.from(out).sort()
}

/** Cuántos instantes de `times` (ordenados) son ≤ t: la «versión» de los datos en t. */
export function countUpTo(times: Float64Array, t: number): number {
  let lo = 0
  let hi = times.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (times[mid]! <= t) lo = mid + 1
    else hi = mid
  }
  return lo
}
