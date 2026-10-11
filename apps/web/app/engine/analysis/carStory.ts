/**
 * Lo que la ficha de una serie de las gráficas de análisis puede decir de un coche (D49), solo con hechos del
 * cronometraje y el texto tal cual de dirección de carrera, todo hasta el corte («Sin spoilers»):
 *
 * - Su último paso por meta (`lastCrossings`) y si entró en el pit lane en esa vuelta (`pitInMs` de su fila).
 * - Hasta `CAR_STORY_MAX` mensajes de dirección de carrera que lo nombran (`parsed.cars`), de las clases de
 *   `CAR_STORY_KINDS`, del más reciente al más antiguo, y cuántos más hay.
 *
 * Nunca dice por qué un coche dejó de pasar por meta: la fuente no lo da. Las horas escritas dentro de los textos de
 * los mensajes no se usan (un solo reloj: `t`). TS puro, sin Vue ni three.
 */
import type { RaceControlEvent } from '@trazada/schema'
import { lapIndex, type LapTable } from './lapTable'
import { lastCrossings } from './raceTrace'

/**
 * Clases de mensaje que cuentan algo de un coche: incidentes, coche detenido, trompo, sanciones y banderas negras. Ni
 * banderas azules ni límites de pista (ruido), ni vueltas anuladas («Ritmo» ya las marca).
 */
export const CAR_STORY_KINDS: ReadonlySet<string> = new Set([
  'incident',
  'car_stopped',
  'spun',
  'penalty',
  'penalty_served',
  'black_flag',
  'black_and_white_flag',
  'black_and_orange_flag',
])

/** Mensajes que lista la ficha como mucho (el resto se cuenta). */
export const CAR_STORY_MAX = 2

export interface CarStory {
  /** Vuelta de su último paso por meta hasta el corte; null sin ninguno. */
  lastLap: number | null
  /** Entró en el pit lane (hasta el corte) en la vuelta de su último paso. */
  pitInOnLastLap: boolean
  /** Mensajes que lo nombran, del más reciente al más antiguo (`max`, por defecto `CAR_STORY_MAX`, como mucho). */
  rc: RaceControlEvent[]
  /** Cuántos más hay de esas clases hasta el corte. */
  rcMore: number
}

/** `max`: cuántos mensajes lista como mucho (la ficha corta, uno). */
export function carStory(
  table: LapTable,
  raceControl: readonly RaceControlEvent[],
  car: string,
  cutoffMs = Infinity,
  max = CAR_STORY_MAX,
): CarStory {
  const last = lastCrossings(table, cutoffMs).get(car)
  const laps = table.cars.get(car)
  let pitInOnLastLap = false
  if (last && laps) {
    const k = lapIndex(laps, last.lap)
    const pitIn = k >= 0 ? laps.pitInMs[k]! : -1
    pitInOnLastLap = pitIn >= 0 && pitIn <= cutoffMs
  }
  const named = raceControl
    .filter((e) => e.t <= cutoffMs && CAR_STORY_KINDS.has(e.parsed.kind) && e.parsed.cars.includes(car))
    .sort((a, b) => b.t - a.t)
  return {
    lastLap: last?.lap ?? null,
    pitInOnLastLap,
    rc: named.slice(0, max),
    rcMore: Math.max(0, named.length - max),
  }
}
