/**
 * Stints de neumáticos por piloto (ítem 3, D33), con los datos del cronometraje tal cual: compuesto, número de stint,
 * vueltas del juego (`tyreLife`, que puede incluir vueltas de otras sesiones con un juego usado) y nuevo o usado.
 * Lo que no viene es «sin dato» (null o 'UNKNOWN'), nunca un valor supuesto.
 *
 * - Un stint son vueltas seguidas con el mismo número de stint y el mismo compuesto. Sin número de stint (0 en las
 *   dos vueltas), también empieza uno nuevo en cada salida de boxes.
 * - Inicio: la salida del pit lane de su primera vuelta (o, si no sale de boxes, el inicio de la vuelta); fin: la
 *   entrada al pit lane de su última vuelta (o el fin de la vuelta). En libres, un stint es una tanda en pista.
 * - Corte («Sin spoilers»): solo las vueltas que ya habían empezado (en pista) en el corte; un stint sin terminar
 *   acaba en el corte (`open`).
 *
 * TS puro (sin Vue ni three).
 */
import { ENUMS } from '@trazada/schema'
import type { CarLaps, LapTable } from './lapTable'

export interface Stint {
  /** Número de stint del cronometraje (0 sin dato). */
  stint: number
  /** Nombre de `ENUMS.compound` ('UNKNOWN' sin dato). */
  compound: string
  firstLap: number
  lastLap: number
  /** Vueltas del stint (filas de la tabla, la que esté en curso incluida). */
  laps: number
  /** Vueltas del juego al final de la primera y de la última vuelta (pueden incluir otras sesiones); null sin dato. */
  tyreLifeFirst: number | null
  tyreLifeLast: number | null
  /** true nuevo, false usado, null sin dato (lo dice la primera vuelta del stint). */
  fresh: boolean | null
  /** Inicio y fin (ms de sesión); NaN si no se sabe. */
  startMs: number
  endMs: number
  /** Sigue en curso en el corte (su fin es el corte). */
  open: boolean
}

export interface CarStints {
  car: string
  stints: readonly Stint[]
}

const UNKNOWN_U8 = 255

/** Nombre del compuesto de un código (los códigos fuera de la lista, 'UNKNOWN'). */
export function compoundName(code: number): string {
  return ENUMS.compound[code] ?? 'UNKNOWN'
}

/** Cuándo empieza una vuelta en pista: la salida del pit lane si la hay; si no, su inicio oficial (NaN sin dato). */
function lapBegin(laps: CarLaps, k: number): number {
  if (laps.pitOutMs[k]! >= 0) return laps.pitOutMs[k]!
  if (laps.startMs[k]! >= 0) return laps.startMs[k]!
  const end = laps.endMs[k]!
  const ms = laps.lapMs[k]!
  return end > 0 && ms > 0 ? end - ms : Number.NaN
}

/** Cuándo acaba una vuelta en pista: la entrada al pit lane si la hay; si no, su fin oficial (NaN sin dato). */
function lapFinish(laps: CarLaps, k: number): number {
  if (laps.pitInMs[k]! >= 0) return laps.pitInMs[k]!
  return laps.endMs[k]! > 0 ? laps.endMs[k]! : Number.NaN
}

export function carStints(laps: CarLaps, cutoffMs = Infinity): CarStints {
  const stints: Stint[] = []
  let cur: Stint | null = null
  for (let k = 0; k < laps.lap.length; k++) {
    const begin = lapBegin(laps, k)
    // Con corte, solo las vueltas que ya habían empezado (sin inicio conocido, no se puede saber: fuera).
    if (cutoffMs !== Infinity && !(begin <= cutoffMs)) continue
    const compound = compoundName(laps.compound[k]!)
    const stint = laps.stint[k]!
    const pitOut = laps.pitOutMs[k]! >= 0
    const life = laps.tyreLife[k]! === UNKNOWN_U8 ? null : laps.tyreLife[k]!
    const same = cur !== null && cur.stint === stint && cur.compound === compound && !(stint === 0 && pitOut)
    if (!same) {
      const fresh = laps.fresh[k]!
      cur = {
        stint,
        compound,
        firstLap: laps.lap[k]!,
        lastLap: laps.lap[k]!,
        laps: 0,
        tyreLifeFirst: life,
        tyreLifeLast: life,
        fresh: fresh === 1 ? true : fresh === 0 ? false : null,
        startMs: begin,
        endMs: Number.NaN,
        open: false,
      }
      stints.push(cur)
    }
    const s = cur!
    s.lastLap = laps.lap[k]!
    s.laps++
    s.tyreLifeLast = life
    const finish = lapFinish(laps, k)
    if (finish <= cutoffMs) {
      s.endMs = finish
      s.open = false
    } else if (cutoffMs !== Infinity) {
      // Sin terminar en el corte (o sin fin conocido): acaba en el corte.
      s.endMs = cutoffMs
      s.open = true
    }
    // Sin corte y sin fin conocido: se queda el último fin conocido del stint (NaN si no hay ninguno).
  }
  return { car: laps.car, stints }
}

/** Stints de todos los coches de la tabla (en su orden). */
export function stints(table: LapTable, cutoffMs = Infinity): CarStints[] {
  return [...table.cars.values()].map((laps) => carStints(laps, cutoffMs))
}

/**
 * Instantes en los que cambia lo que muestran los stints (inicio y fin en pista de cada vuelta), ordenados: la
 * interfaz solo recalcula cuando el reloj cruza uno.
 */
export function stintEventTimes(table: LapTable): Float64Array {
  const out: number[] = []
  for (const c of table.cars.values()) {
    for (let k = 0; k < c.lap.length; k++) {
      const b = lapBegin(c, k)
      const f = lapFinish(c, k)
      if (Number.isFinite(b)) out.push(b)
      if (Number.isFinite(f)) out.push(f)
    }
  }
  return Float64Array.from(out).sort()
}
