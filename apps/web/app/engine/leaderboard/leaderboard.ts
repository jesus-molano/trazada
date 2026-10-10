/**
 * Leaderboard en el instante t, solo con datos reales de cronometraje:
 *
 * - Posición: la de la torre oficial (stream del live timing) si existe. Si no, en carrera, el orden en la
 *   línea (vueltas completadas, y a igualdad, quién cruzó antes); en el resto de sesiones, la mejor vuelta.
 *   Un coche que no sale en la torre, o sin paso por meta (carrera) ni vuelta válida (resto) cuando no hay
 *   torre, ocupa un puesto en la lista pero su posición es desconocida (`positionKnown: false`).
 * - Gap e intervalo: los de la torre; si faltan, los tiempos de paso por la línea (carrera) o la
 *   diferencia de mejor vuelta (resto). Nunca negativos: si saldrían negativos (orden de la torre y mejores
 *   vueltas desacompasados), sin dato. En carrera sin torre, «+N vueltas» solo para un coche doblado; uno al que
 *   el líder solo le saca la línea que acaba de cruzar no está doblado: su gap de esa vuelta es sin dato.
 * - Vueltas anuladas: cuentan hasta el mensaje de dirección de carrera que las anula (ver `deletionTimes`).
 * - Clasificación (Q y SQ): las mejores vueltas son las de la tanda en curso (Q1/Q2/Q3), delimitadas por los
 *   mensajes de bandera a cuadros (fin de tanda) y luz verde (inicio de la siguiente). Sin esos mensajes, toda
 *   la sesión cuenta como una tanda.
 * - Neumático: compuesto y edad de la vuelta en curso (tabla de vueltas).
 *
 * Las vueltas de cada coche (pasos por meta reales, anulaciones y tandas) salen del índice compartido
 * `buildLapTable` (`engine/analysis/lapTable.ts`).
 */
import { ENUMS, type DecodedTrzb, type DriverInfo, type SessionEvents, type SessionType } from '@trazada/schema'
import { buildLapTable, type CarLaps, lastCompletedIndex, type LapTable, segmentAt } from '../analysis/lapTable'
import type { CarState } from '../replay/ReplayModel'

export { qualifyingSegments } from '../analysis/lapTable'

/** Una bandera azul se muestra este tiempo después del mensaje (los mensajes son instantáneos). */
export const BLUE_FLAG_MS = 8000

export interface LeaderboardRow {
  car: string
  driver: DriverInfo | null
  /** Puesto en la lista (1…N, siempre único). */
  position: number
  /** La posición sale de la torre, de los pasos por meta o de una vuelta válida; si no, se muestra sin dato. */
  positionKnown: boolean
  /** ms al líder (o a la mejor vuelta); null = sin dato. */
  gapMs: number | null
  intervalMs: number | null
  lapsBehind: number
  /** Vuelta en curso (1…) o 0 antes de empezar. */
  lap: number
  compound: string
  tyreLife: number | null
  /** Mejor vuelta válida hasta t (en clasificación, de la tanda en curso). */
  bestLapMs: number | null
  inPit: boolean
  noSignal: boolean
  blueFlag: boolean
}

/**
 * Reglas del orden en la línea de meta (carrera sin torre), compartidas con la vista previa del timeline: lo que
 * cuenta de cada coche en t son sus vueltas completadas (pasos por meta reales, sin los registros residuales de un
 * retirado: ver `buildLapTable`) y cuándo cruzó la línea por última vez.
 */
export interface LineKey {
  /** Vueltas completadas en t (número de la última vuelta con paso por meta real); 0 sin ninguna. */
  done: number
  /** Último paso por meta (ms de sesión); Infinity sin ninguno. */
  cross: number
}

/** Vueltas completadas y último paso por meta de un coche en t (`lastCompletedIndex`). */
export function lineKeyAt(laps: CarLaps | undefined, t: number): LineKey {
  const k = laps ? lastCompletedIndex(laps, t) : -1
  return k < 0 ? { done: 0, cross: Infinity } : { done: laps!.lap[k]!, cross: laps!.crossMs[k]! }
}

/**
 * Orden en la línea: primero quien ha completado más vueltas; con las mismas, quien cruzó antes. 0 es un empate que
 * estas reglas no deshacen (la clasificación lo deshace con la posición en pista; la vista previa del timeline no, y
 * lo deja sin dato).
 */
export function compareAtLine(a: LineKey, b: LineKey): number {
  return b.done - a.done || (a.cross === b.cross ? 0 : a.cross - b.cross)
}

/**
 * Reglas del orden por mejor vuelta (libres y clasificación sin torre), compartidas con la vista previa del timeline:
 * la última tanda en la que el coche tiene una vuelta válida en t (con tiempo oficial y no anulada a esa hora) y su
 * mejor vuelta en esa tanda. Fuera de clasificación hay una sola tanda (la 0).
 */
export interface BestLapKey {
  /** Última tanda con vuelta válida; −1 sin ninguna. */
  seg: number
  /** Mejor vuelta (ms) en esa tanda; Infinity sin ninguna. */
  best: number
}

/** Última tanda con vuelta válida y mejor vuelta en ella, de un coche en t. */
export function bestLapKeyAt(laps: CarLaps | undefined, t: number): BestLapKey {
  let seg = -1
  let best = Infinity
  if (!laps) return { seg, best }
  for (let k = 0; k < laps.lap.length; k++) {
    const end = laps.crossMs[k]!
    if (!(end > 0 && end <= t)) continue
    const ms = laps.lapMs[k]!
    const s = laps.segment[k]!
    if (ms > 0 && s >= 0 && laps.deletedFrom[k]! > t) {
      if (s > seg) {
        seg = s
        best = ms
      } else if (s === seg && ms < best) best = ms
    }
  }
  return { seg, best }
}

/**
 * Orden por mejor vuelta: primero la tanda más reciente con tiempo (en clasificación, los que siguen en la tanda en
 * curso antes que los eliminados); dentro de ella, la vuelta más rápida. 0 es un empate que estas reglas no deshacen.
 */
export function compareByBestLap(a: BestLapKey, b: BestLapKey): number {
  return b.seg - a.seg || (a.best === b.best ? 0 : a.best - b.best)
}

interface StreamRows {
  t: Float64Array
  position: Uint8Array
  gap: Int32Array
  interval: Int32Array
  lapsBehind: Uint8Array
}

function lastAtOrBefore(t: Float64Array, x: number): number {
  let lo = 0
  let hi = t.length - 1
  if (hi < 0 || t[0]! > x) return -1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (t[mid]! <= x) lo = mid
    else hi = mid - 1
  }
  return lo
}

export class LeaderboardEngine {
  readonly race: boolean
  /** Índice de vueltas de la sesión (compartido con otros análisis por vuelta). */
  readonly lapTable: LapTable
  private readonly laps: ReadonlyMap<string, CarLaps>
  private readonly stream = new Map<string, StreamRows>()
  private readonly hasStream: boolean
  private readonly blue: { t: number; cars: string[] }[]

  constructor(
    type: SessionType,
    timing: DecodedTrzb,
    events: SessionEvents,
    private readonly drivers: DriverInfo[],
  ) {
    // Vueltas por coche: pasos por meta reales, anulaciones desde su mensaje y tandas de clasificación.
    this.lapTable = buildLapTable(type, timing, events.raceControl)
    this.race = this.lapTable.race
    this.laps = this.lapTable.cars

    const st = timing.tables.stream
    if (st && st.rows > 0) {
      const c = st.columns
      const byCar = new Map<string, number[]>()
      for (let i = 0; i < st.rows; i++) {
        const car = String(c.car![i])
        ;(byCar.get(car) ?? byCar.set(car, []).get(car)!).push(i)
      }
      for (const [car, idx] of byCar) {
        idx.sort((a, b) => c.t![a]! - c.t![b]!)
        this.stream.set(car, {
          t: Float64Array.from(idx, (i) => c.t![i]!),
          position: Uint8Array.from(idx, (i) => c.position![i]!),
          gap: Int32Array.from(idx, (i) => c.gapToLeaderMs![i]!),
          interval: Int32Array.from(idx, (i) => c.intervalMs![i]!),
          lapsBehind: Uint8Array.from(idx, (i) => c.lapsBehind![i]!),
        })
      }
    }
    this.hasStream = this.stream.size > 0
    this.blue = events.raceControl
      .filter((e) => e.parsed.kind === 'blue_flag' && e.parsed.cars.length > 0)
      .map((e) => ({ t: e.t, cars: e.parsed.cars }))
      .sort((a, b) => a.t - b.t)
  }

  /** Coches con bandera azul vigente en t. */
  blueFlagsAt(t: number): Set<string> {
    const out = new Set<string>()
    let lo = 0
    let hi = this.blue.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.blue[mid]!.t < t - BLUE_FLAG_MS) lo = mid + 1
      else hi = mid
    }
    for (let i = lo; i < this.blue.length && this.blue[i]!.t <= t; i++) for (const c of this.blue[i]!.cars) out.add(c)
    return out
  }

  /**
   * Compuesto que lleva puesto un coche en t (para la banda del neumático en 3D). Es el de su vuelta en
   * curso, salvo en una parada con cambio de compuesto: desde la entrada al pit hasta la salida no se sabe
   * qué neumáticos lleva (la vuelta de salida empieza al cruzar la línea en el pit lane, antes del cambio),
   * así que 'UNKNOWN'. Sin vueltas, 'UNKNOWN'. (La clasificación muestra el de la vuelta en curso.)
   */
  compoundAt(car: string, t: number): string {
    const laps = this.laps.get(car)
    if (!laps) return 'UNKNOWN'
    let k = -1
    for (let j = 0; j < laps.lap.length; j++) if (laps.startMs[j]! >= 0 && laps.startMs[j]! <= t) k = j
    if (k < 0) return 'UNKNOWN'
    const c = laps.compound[k]!
    const n = laps.lap.length
    // Vuelta de entrada: ya en el pit, antes de cruzar la línea.
    if (k + 1 < n && laps.compound[k + 1] !== c && laps.pitInMs[k]! >= 0 && t >= laps.pitInMs[k]!) return 'UNKNOWN'
    // Vuelta de salida: aún sin salir del pit.
    if (k > 0 && laps.compound[k - 1] !== c && laps.pitOutMs[k]! >= 0 && t < laps.pitOutMs[k]!) return 'UNKNOWN'
    return ENUMS.compound[c] ?? 'UNKNOWN'
  }

  /** Tanda de clasificación en curso en t (0 fuera de clasificación). */
  segmentAt(t: number): number {
    return segmentAt(this.lapTable.segments, t)
  }

  compute(t: number, states: readonly CarState[]): LeaderboardRow[] {
    const blue = this.blueFlagsAt(t)
    const stateOf = new Map(states.map((s) => [s.car, s]))
    const current = this.segmentAt(t)
    const rows: Work[] = []
    for (const d of this.drivers) {
      const st = stateOf.get(d.number)
      const laps = this.laps.get(d.number)
      // Vueltas completadas y último paso por meta (orden en la línea); última tanda con vuelta válida y su mejor
      // vuelta (orden por mejor vuelta; fuera de clasificación, una sola tanda).
      const line = lineKeyAt(laps, t)
      const best = bestLapKeyAt(laps, t)
      let lap = 0
      let compound = 'UNKNOWN'
      let tyreLife: number | null = null
      if (laps) {
        // Vuelta en curso
        for (let k = 0; k < laps.lap.length; k++) {
          if (laps.startMs[k]! >= 0 && laps.startMs[k]! <= t) {
            lap = laps.lap[k]!
            compound = ENUMS.compound[laps.compound[k]!] ?? 'UNKNOWN'
            const life = laps.tyreLife[k]!
            tyreLife = life === 255 ? null : life
          }
        }
      }
      rows.push({
        car: d.number,
        driver: d,
        position: 0,
        positionKnown: false,
        gapMs: null,
        intervalMs: null,
        lapsBehind: 0,
        lap,
        compound,
        tyreLife,
        bestLapMs: best.seg >= 0 && best.seg === current ? best.best : null,
        inPit: !!st?.visible && st.inPit,
        noSignal: !st?.visible,
        blueFlag: blue.has(d.number),
        _line: line,
        _best: best,
        _s: st?.visible ? st.s : -Infinity,
      })
    }

    if (this.hasStream) this.applyStream(t, rows)
    if (!this.hasStream || rows.every((r) => r.position === 0)) {
      if (this.race) this.orderAtLine(rows)
      else this.orderByBestLap(rows)
    } else {
      rows.sort((a, b) => (a.position || 99) - (b.position || 99) || b._s - a._s)
      rows.forEach((r, i) => (r.position = i + 1))
      if (!this.race) this.bestLapGaps(rows)
    }
    for (const r of rows) {
      if (r.gapMs !== null && r.gapMs < 0) r.gapMs = null
      if (r.intervalMs !== null && r.intervalMs < 0) r.intervalMs = null
    }
    return rows.map(({ _line, _best, _s, ...r }) => r)
  }

  private applyStream(t: number, rows: Work[]): void {
    for (const r of rows) {
      const st = this.stream.get(r.car)
      if (!st) continue
      const i = lastAtOrBefore(st.t, t)
      if (i < 0) continue
      r.position = st.position[i]!
      r.positionKnown = r.position > 0
      r.gapMs = st.gap[i]! >= 0 ? st.gap[i]! : null
      r.intervalMs = st.interval[i]! >= 0 ? st.interval[i]! : null
      r.lapsBehind = st.lapsBehind[i]!
    }
  }

  /** Carrera sin torre: orden en la línea de meta y gaps con los tiempos de paso. */
  private orderAtLine(rows: Work[]): void {
    // Las reglas compartidas (`compareAtLine`) y, a igualdad exacta, la posición en pista.
    rows.sort((a, b) => compareAtLine(a._line, b._line) || b._s - a._s)
    const leader = rows[0]
    rows.forEach((r, i) => {
      const { done, cross } = r._line
      r.position = i + 1
      // Sin paso por meta, el puesto en la lista no es una posición (p. ej. antes de la salida).
      r.positionKnown = done > 0
      if (!leader || done === 0) return
      // Vueltas perdidas: solo si está doblado. Lo está si el líder ya había completado más vueltas cuando el
      // coche cruzó la línea por última vez, o si el líder le saca dos líneas o más (al menos una vuelta). Si el
      // líder solo acaba de cruzar la línea siguiente, no está doblado: el gap de esta vuelta aún no se conoce.
      r.lapsBehind = Math.max(0, this.doneAt(leader.car, cross) - done, leader._line.done - done - 1)
      const leaderCross = this.crossingOf(leader.car, done)
      r.gapMs = leader._line.done === done && leaderCross !== null ? cross - leaderCross : null
      const ahead = rows[i - 1]
      if (ahead) {
        const aheadCross = this.crossingOf(ahead.car, done)
        r.intervalMs = aheadCross !== null ? cross - aheadCross : null
      }
    })
    if (leader && leader._line.done > 0) {
      leader.gapMs = 0
      leader.intervalMs = null
    }
  }

  /** Vueltas completadas por un coche hasta el instante x (pasos por meta reales). */
  private doneAt(car: string, x: number): number {
    const laps = this.laps.get(car)
    let done = 0
    if (laps) for (let k = 0; k < laps.lap.length; k++) if (laps.crossMs[k]! > 0 && laps.crossMs[k]! <= x) done = laps.lap[k]!
    return done
  }

  private crossingOf(car: string, lap: number): number | null {
    const laps = this.laps.get(car)
    if (!laps) return null
    for (let k = 0; k < laps.lap.length; k++) if (laps.lap[k] === lap && laps.crossMs[k]! > 0) return laps.crossMs[k]!
    return null
  }

  /**
   * Libres y clasificación sin torre: orden por mejor vuelta hasta t. En clasificación, primero los que tienen
   * tiempo en la tanda en curso y después los eliminados (o sin tiempo aún), cada uno por su última tanda.
   */
  private orderByBestLap(rows: Work[]): void {
    // Las reglas compartidas (`compareByBestLap`) y, a igualdad exacta, la posición en pista.
    rows.sort((a, b) => compareByBestLap(a._best, b._best) || b._s - a._s)
    rows.forEach((r, i) => {
      r.position = i + 1
      r.positionKnown = r._best.seg >= 0
    })
    this.bestLapGaps(rows)
  }

  /** Gap e intervalo por mejor vuelta (de la tanda en curso en clasificación) donde la torre no los da. */
  private bestLapGaps(rows: LeaderboardRow[]): void {
    const bests = rows.map((r) => r.bestLapMs).filter((v): v is number => v !== null)
    const fastest = bests.length ? Math.min(...bests) : null
    rows.forEach((r, i) => {
      if (r.gapMs === null && r.bestLapMs !== null && fastest !== null) r.gapMs = r.bestLapMs - fastest
      const ahead = rows[i - 1]
      if (r.intervalMs === null && ahead?.bestLapMs != null && r.bestLapMs !== null) {
        r.intervalMs = r.bestLapMs - ahead.bestLapMs
      }
    })
  }
}

type Work = LeaderboardRow & { _line: LineKey; _best: BestLapKey; _s: number }
