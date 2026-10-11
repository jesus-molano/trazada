/**
 * Ritmo por vuelta (ítem 3, D33): los tiempos oficiales de cada vuelta, tal cual (sin corrección de combustible ni
 * suavizado: serían estimaciones). Las vueltas que no sirven para comparar ritmo se marcan con su motivo, nunca se
 * quitan: entrada o salida de boxes, SC/VSC/roja durante la vuelta, vuelta 1, anulada (desde su mensaje) y sin
 * tiempo oficial (no se pueden dibujar, pero se cuentan).
 *
 * - Corte («Sin spoilers»): una vuelta se conoce al acabar (`endMs` ≤ corte); sin fin conocido, solo sin corte. Una
 *   vuelta anulada lo está desde el mensaje de dirección de carrera (`lapFlagsAt` en el corte).
 * - En carrera y sprint el eje es el número de vuelta; en libres y clasificación, el instante en que acaba cada
 *   vuelta (ms de sesión), porque las tandas de cada piloto no van a la par.
 *
 * TS puro (sin Vue ni three).
 */
import {
  type CarLaps,
  LAP_DELETED,
  LAP_FIRST,
  LAP_NEUTRALISED,
  LAP_NO_TIME,
  LAP_PIT,
  lapFlagsAt,
  type LapTable,
} from './lapTable'

/** Por qué una vuelta no cuenta para comparar ritmo. */
export type PaceExclusion = 'first' | 'pit' | 'neutralised' | 'deleted' | 'noTime'

/** Orden fijo de los motivos (el primero es el que se nombra si hay varios). */
export const PACE_EXCLUSIONS: readonly PaceExclusion[] = ['first', 'pit', 'neutralised', 'deleted', 'noTime']

const EXCLUSION_BITS: Record<PaceExclusion, number> = {
  first: LAP_FIRST,
  pit: LAP_PIT,
  neutralised: LAP_NEUTRALISED,
  deleted: LAP_DELETED,
  noTime: LAP_NO_TIME,
}

export interface PaceLap {
  lap: number
  /** Tiempo oficial (ms); null sin tiempo oficial. */
  lapMs: number | null
  /** Inicio y fin oficiales (ms de sesión); −1 desconocido. */
  startMs: number
  endMs: number
  /** Clasificación de la vuelta en el corte (bits `LAP_*`). */
  flags: number
  /** Motivos por los que no es representativa (vacío: representativa). */
  excluded: readonly PaceExclusion[]
}

export interface CarPace {
  car: string
  laps: readonly PaceLap[]
}

/** Motivos de exclusión de unas banderas `LAP_*`. */
export function exclusionsOf(flags: number): PaceExclusion[] {
  return PACE_EXCLUSIONS.filter((e) => (flags & EXCLUSION_BITS[e]) !== 0)
}

/** Vueltas de un coche conocidas en el corte, con sus marcas (ninguna se quita). */
export function carPace(laps: CarLaps, cutoffMs = Infinity): CarPace {
  const out: PaceLap[] = []
  for (let k = 0; k < laps.lap.length; k++) {
    const endMs = laps.endMs[k]!
    if (cutoffMs !== Infinity && !(endMs > 0 && endMs <= cutoffMs)) continue
    const flags = lapFlagsAt(laps, k, cutoffMs)
    const ms = laps.lapMs[k]!
    out.push({
      lap: laps.lap[k]!,
      lapMs: ms > 0 ? ms : null,
      startMs: laps.startMs[k]!,
      endMs,
      flags,
      excluded: exclusionsOf(flags),
    })
  }
  return { car: laps.car, laps: out }
}

/** Ritmo de los coches pedidos (en ese orden; un coche sin vueltas en la tabla, sin vueltas). */
export function pace(table: LapTable, cars: readonly string[], cutoffMs = Infinity): CarPace[] {
  return cars.map((car) => {
    const laps = table.cars.get(car)
    return laps ? carPace(laps, cutoffMs) : { car, laps: [] }
  })
}

export type PaceAxis = 'lap' | 'time'

/** Eje de la gráfica de ritmo de una sesión: por vuelta en carrera y sprint; por instante en el resto. */
export function paceAxis(table: LapTable): PaceAxis {
  return table.race ? 'lap' : 'time'
}

/** Series de un coche, alineadas con `PaceChart.x` (s; null donde no hay punto). */
export interface PaceChartCar {
  car: string
  /** Vueltas representativas (punto relleno y línea entre vueltas seguidas). */
  normal: (number | null)[]
  /** Excluidas sin anular (punto hueco). */
  excluded: (number | null)[]
  /** Anuladas (aspa). */
  deleted: (number | null)[]
  /** Vueltas conocidas sin tiempo oficial (no se dibujan; se cuentan). */
  noTime: number
  /** La vuelta 1 está y no tiene tiempo oficial (salida de carrera: «sin tiempo oficial»). */
  lap1NoTime: boolean
}

export interface PaceChart {
  axis: PaceAxis
  /** Número de vuelta (eje por vuelta) o fin de la vuelta en ms de sesión (eje por instante), ascendente. */
  x: number[]
  /** Por instante: inicio de una de las vueltas que acaban en cada x (para saltar); −1 desconocido. */
  startMs: number[]
  cars: PaceChartCar[]
}

/** Series para la gráfica: tiempos en segundos, una entrada por x de cada coche. */
export function paceChart(paces: readonly CarPace[], axis: PaceAxis): PaceChart {
  const plotted = (l: PaceLap) => l.lapMs !== null && (axis === 'lap' ? l.lap >= 1 : l.endMs > 0)
  let x: number[]
  const startByX = new Map<number, number>()
  if (axis === 'lap') {
    let n = 0
    for (const p of paces) for (const l of p.laps) if (plotted(l) && l.lap > n) n = l.lap
    x = Array.from({ length: n }, (_, i) => i + 1)
  } else {
    for (const p of paces) {
      for (const l of p.laps) {
        if (!plotted(l)) continue
        const start = l.startMs >= 0 ? l.startMs : l.endMs - l.lapMs!
        if (!startByX.has(l.endMs)) startByX.set(l.endMs, start)
      }
    }
    x = [...startByX.keys()].sort((a, b) => a - b)
  }
  const index = new Map(x.map((v, i) => [v, i]))
  const cars = paces.map((p): PaceChartCar => {
    const normal: (number | null)[] = x.map(() => null)
    const excluded: (number | null)[] = x.map(() => null)
    const deleted: (number | null)[] = x.map(() => null)
    let noTime = 0
    let lap1NoTime = false
    for (const l of p.laps) {
      if (l.lapMs === null) {
        noTime++
        if (l.lap === 1) lap1NoTime = true
        continue
      }
      const i = index.get(axis === 'lap' ? l.lap : l.endMs)
      if (i === undefined) continue
      const s = l.lapMs / 1000
      const target = l.excluded.includes('deleted') ? deleted : l.excluded.length ? excluded : normal
      // Con dos filas en el mismo punto, la primera (como `lapIndex`).
      if (normal[i] === null && excluded[i] === null && deleted[i] === null) target[i] = s
    }
    return { car: p.car, normal, excluded, deleted, noTime, lap1NoTime }
  })
  return { axis, x, startMs: axis === 'time' ? x.map((v) => startByX.get(v)!) : x.map(() => -1), cars }
}

/**
 * Rango del eje y que encuadra las vueltas representativas (con un margen), para que las excluidas (boxes, SC) no
 * aplasten el ritmo. null si no hay ninguna representativa. Las que quedan fuera se cuentan con `outsideRange`.
 */
export function representativeRange(chart: PaceChart, cars: readonly string[] = chart.cars.map((c) => c.car)): [number, number] | null {
  let lo = Infinity
  let hi = -Infinity
  for (const c of chart.cars) {
    if (!cars.includes(c.car)) continue
    for (const v of c.normal) {
      if (v === null) continue
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
  }
  if (lo === Infinity) return null
  const pad = Math.max(0.5, (hi - lo) * 0.08)
  return [lo - pad, hi + pad]
}

/** Puntos dibujables (de los coches dados) que caen fuera del rango. */
export function outsideRange(chart: PaceChart, range: [number, number], cars: readonly string[] = chart.cars.map((c) => c.car)): number {
  let n = 0
  for (const c of chart.cars) {
    if (!cars.includes(c.car)) continue
    for (const list of [c.normal, c.excluded, c.deleted]) for (const v of list) if (v !== null && (v < range[0] || v > range[1])) n++
  }
  return n
}

/**
 * Instantes en los que cambia lo que muestra el ritmo (fin de cada vuelta y momento de cada anulación), ordenados:
 * la interfaz solo recalcula cuando el reloj cruza uno.
 */
export function paceEventTimes(table: LapTable): Float64Array {
  const out: number[] = []
  for (const c of table.cars.values()) {
    for (let k = 0; k < c.lap.length; k++) {
      if (c.endMs[k]! > 0) out.push(c.endMs[k]!)
      if (Number.isFinite(c.deletedFrom[k]!)) out.push(c.deletedFrom[k]!)
    }
  }
  return Float64Array.from(out).sort()
}
