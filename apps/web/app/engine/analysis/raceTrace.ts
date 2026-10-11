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
 * - Posición en la línea (`posAtLine`, D49): el orden de paso de esa vuelta, con los mismos pasos por meta oficiales.
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
  /**
   * Posición en la línea en cada vuelta de `RaceTrace.laps` (0 sin paso por meta): 1 + los coches que cruzaron esa
   * misma vuelta antes (hasta el corte). Un doblado cuenta por la vuelta que completa, no por su sitio en la pista.
   */
  posAtLine: Int16Array
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
  // Pasos por meta de cada vuelta (los de la serie: la primera fila de cada número), para la posición en la línea.
  const byLap: number[][] = Array.from({ length: n }, () => [])
  const crossed: Float64Array[] = []
  for (const c of table.cars.values()) {
    const gapMs = new Float64Array(n).fill(Number.NaN)
    const at = new Float64Array(n).fill(Number.NaN)
    let lastLap = 0
    for (let k = 0; k < c.lap.length; k++) {
      const lap = c.lap[k]!
      const x = crossing(c.crossMs, k, cutoffMs)
      // Con dos filas con el mismo número de vuelta, cuenta la primera (como `lapIndex`).
      if (lap < 1 || Number.isNaN(x) || !Number.isNaN(gapMs[lap - 1]!)) continue
      gapMs[lap - 1] = x - leaderMs[lap - 1]!
      at[lap - 1] = x
      byLap[lap - 1]!.push(x)
      if (lap > lastLap) lastLap = lap
    }
    series.push({ car: c.car, gapMs, lastLap, posAtLine: new Int16Array(n) })
    crossed.push(at)
  }
  for (const list of byLap) list.sort((a, b) => a - b)
  series.forEach((s, j) => {
    const at = crossed[j]!
    for (let i = 0; i < n; i++) if (!Number.isNaN(at[i]!)) s.posAtLine[i] = 1 + countBelow(byLap[i]!, at[i]!)
  })
  return { laps: Int32Array.from({ length: n }, (_, i) => i + 1), leaderMs, leaderCar, series }
}

/** Cuántos valores de `sorted` (ascendente) son estrictamente menores que v. */
function countBelow(sorted: readonly number[], v: number): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid]! < v) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Vueltas que completa el primero desde el último paso por meta de un coche para darlo por detenido. */
export const STOPPED_AFTER_LAPS = 3

/** Último paso por meta de un coche: su vuelta y su instante (ms de sesión). */
export interface LastCrossing {
  lap: number
  ms: number
}

/**
 * Último paso por meta de cada coche hasta el corte (el más tardío; con dos filas con el mismo número de vuelta, cuenta
 * la primera, como la serie de `raceTrace` y `lapIndex`). Sin ningún paso, el coche no está.
 */
export function lastCrossings(table: LapTable, cutoffMs = Infinity): Map<string, LastCrossing> {
  const out = new Map<string, LastCrossing>()
  for (const c of table.cars.values()) {
    const seen = new Set<number>()
    for (let k = 0; k < c.lap.length; k++) {
      const lap = c.lap[k]!
      const x = crossing(c.crossMs, k, cutoffMs)
      if (lap < 1 || Number.isNaN(x) || seen.has(lap)) continue
      seen.add(lap)
      const prev = out.get(c.car)
      if (!prev || x > prev.ms) out.set(c.car, { lap, ms: x })
    }
  }
  return out
}

/**
 * Coches que dejaron de pasar por meta hasta el corte, con su última vuelta. Dos reglas:
 *
 * - El primero ha completado al menos `STOPPED_AFTER_LAPS` vueltas desde su último paso. Un coche doblado sigue
 *   cruzando la línea cada vuelta (entre dos de sus pasos, el primero cruza una vez, dos si va más lento o entra en
 *   boxes), así que no cuenta.
 * - Fin de los datos (D49): con todos los pasos por meta a la vista (el corte no deja fuera ninguno), su último paso es
 *   anterior al último paso del primero (el más temprano de la vuelta más alta que alguien completó). Todo coche que
 *   sigue en marcha cruza la línea después de que el primero recibe la bandera, así que un doblado nunca cuenta; uno
 *   que se para en la última vuelta, sí (si no, su sigla saldría en la columna final como si hubiera terminado).
 *
 * La fuente no dice por qué (retirado, parado o sin más datos), así que no se afirma nada más: solo sirve para que su
 * sigla no se quede suelta a media gráfica y la leyenda los junte aparte.
 */
export function stoppedCars(table: LapTable, cutoffMs = Infinity): Map<string, number> {
  const leader = new Map<number, number>()
  let latest = -Infinity
  for (const c of table.cars.values()) {
    const seen = new Set<number>()
    for (let k = 0; k < c.lap.length; k++) {
      const lap = c.lap[k]!
      if (c.crossMs[k]! > latest) latest = c.crossMs[k]!
      const x = crossing(c.crossMs, k, cutoffMs)
      // Con dos filas con el mismo número de vuelta, cuenta la primera (como la serie de `raceTrace` y `lapIndex`).
      if (lap < 1 || Number.isNaN(x) || seen.has(lap)) continue
      seen.add(lap)
      const best = leader.get(lap)
      if (best === undefined || x < best) leader.set(lap, x)
    }
  }
  const last = lastCrossings(table, cutoffMs)
  const allVisible = latest > 0 && cutoffMs >= latest
  let topLap = 0
  for (const lap of leader.keys()) if (lap > topLap) topLap = lap
  const leaderFinalMs = leader.get(topLap) ?? -Infinity
  const out = new Map<string, number>()
  for (const [car, l] of last) {
    let after = 0
    for (const ms of leader.values()) if (ms > l.ms) after++
    if (after >= STOPPED_AFTER_LAPS || (allVisible && l.ms < leaderFinalMs)) out.set(car, l.lap)
  }
  return out
}

/**
 * Leyenda del race trace por grupos (D49): los que siguen, de arriba abajo; los detenidos, como la clasificación; y, con
 * todos los pasos por meta a la vista, los que no tienen ninguno en los datos.
 */
export interface LegendOrder {
  /**
   * Coches que no se han detenido y tienen algún paso por meta, por el valor de su último dato (el gap: arriba, el
   * menor), luego por su último paso y luego por `order`: es el orden en que acaban las líneas de arriba abajo, así que
   * nombra las siglas que no caben. Con corte, detrás van los que aún no tienen ninguno, en el orden de `order`.
   */
  running: string[]
  /** Detenidos (`stoppedCars`): por última vuelta, de más a menos, y luego por su último paso. */
  stopped: string[]
  /**
   * Con todos los pasos por meta a la vista (`allVisible`): los que no tienen ninguno en los datos, en el orden de
   * `order`. Con corte, vacío: decir que un coche no tiene vueltas en los datos adelantaría que no va a completar
   * ninguna, así que se quedan al final de `running`, como los que aún no han cruzado.
   */
  none: string[]
}

/**
 * Orden de la leyenda del race trace. `order`: el orden por defecto (el del manifest, con los pilotos que no están en
 * las series; por defecto, el de las series); los coches de las series que no estén en él van detrás, en el orden de
 * las series. `allVisible`: el corte no deja fuera ningún paso por meta.
 */
export function legendOrder(
  trace: RaceTrace,
  stopped: ReadonlyMap<string, number>,
  last: ReadonlyMap<string, LastCrossing>,
  order: readonly string[] = trace.series.map((s) => s.car),
  allVisible = false,
): LegendOrder {
  const cars = [...order, ...trace.series.map((s) => s.car).filter((c) => !order.includes(c))]
  const rank = new Map(cars.map((c, i) => [c, i]))
  const endValue = new Map<string, number>()
  for (const s of trace.series) {
    for (let i = s.gapMs.length - 1; i >= 0; i--) {
      if (!Number.isNaN(s.gapMs[i]!)) {
        endValue.set(s.car, s.gapMs[i]!)
        break
      }
    }
  }
  const crossed = cars.filter((c) => !stopped.has(c) && last.has(c) && endValue.has(c))
  crossed.sort((a, b) => endValue.get(a)! - endValue.get(b)! || last.get(a)!.ms - last.get(b)!.ms || rank.get(a)! - rank.get(b)!)
  const waiting = cars.filter((c) => !stopped.has(c) && !crossed.includes(c))
  const out = cars.filter((c) => stopped.has(c))
  out.sort(
    (a, b) =>
      stopped.get(b)! - stopped.get(a)! ||
      (last.get(a)?.ms ?? Infinity) - (last.get(b)?.ms ?? Infinity) ||
      rank.get(a)! - rank.get(b)!,
  )
  return allVisible ? { running: crossed, stopped: out, none: waiting } : { running: [...crossed, ...waiting], stopped: out, none: [] }
}

/** ¿El corte deja ver todos los pasos por meta? `times`: `crossingTimes` (ordenados). */
export function allCrossingsVisible(times: Float64Array, cutoffMs: number): boolean {
  return times.length === 0 || cutoffMs >= times[times.length - 1]!
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
