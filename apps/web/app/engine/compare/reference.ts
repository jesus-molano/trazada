/**
 * Vuelta de referencia del coche B con la que se compara la vuelta en curso del coche A (ítem 1, D31; TS puro, sin
 * Vue ni three). Solo con el cronometraje oficial (tabla de vueltas): qué vuelta es, no dónde estaba el coche.
 *
 * - `same` (misma vuelta): la vuelta de B con el mismo número que la de A. Es la pelea en pista: la referencia por
 *   defecto en carrera y sprint.
 * - `best` (mejor vuelta): la vuelta más rápida con tiempo oficial que B había completado cuando A empezó su vuelta.
 *   Nunca la vuelta 1 (en carrera no tiene tiempo oficial y en libres es la salida del box) ni una vuelta anulada
 *   (con lo que se sabe en el instante actual). Por defecto en libres y clasificación.
 * - `last` (última vuelta): la última vuelta que B había completado cuando A empezó la suya (sin la vuelta 1).
 *
 * La mejor y la última vuelta se fijan al empezar A su vuelta: durante toda la vuelta se compara con la misma, aunque B
 * cierre otra mientras tanto. Nada sale del futuro: una vuelta de referencia solo cuenta si ya había empezado (misma
 * vuelta) o terminado (mejor y última) en el instante actual.
 */
import type { SessionType } from '@trazada/schema'
import { type CarLaps, LAP_DELETED, LAP_FIRST, lapFlagsAt, lapIndex } from '../analysis/lapTable'
import { lapStartTime } from './laps'

export const COMPARE_REFS = ['same', 'best', 'last'] as const
export type CompareRef = (typeof COMPARE_REFS)[number]

export const isCompareRef = (x: unknown): x is CompareRef => (COMPARE_REFS as readonly unknown[]).includes(x)

/** En carrera y sprint, la misma vuelta (la pelea en pista); en libres y clasificación, la mejor vuelta. */
export function defaultCompareRef(type: SessionType): CompareRef {
  return type === 'race' || type === 'sprint' ? 'same' : 'best'
}

/**
 * Por qué no hay vuelta de referencia:
 * - `noLap`: B no tiene esa vuelta (misma vuelta) o aún no había completado ninguna que sirva (mejor, última).
 * - `notStarted`: B aún no había empezado esa vuelta en el instante actual (misma vuelta).
 */
export type RefMissing = 'noLap' | 'notStarted'

export type RefLapResult = { ok: true; j: number } | { ok: false; reason: RefMissing }

/**
 * Vuelta de referencia de B (índice en `lapsB`) para la vuelta número `lapA` de A, que empezó en `startA` (ms de
 * sesión), vista en `now`. `startA` solo cuenta para la mejor y la última vuelta.
 */
export function referenceLap(lapsB: CarLaps, mode: CompareRef, lapA: number, startA: number, now: number): RefLapResult {
  if (mode === 'same') {
    const j = lapIndex(lapsB, lapA)
    if (j < 0) return { ok: false, reason: 'noLap' }
    const start = lapStartTime(lapsB, j)
    if (start !== null && start > now) return { ok: false, reason: 'notStarted' }
    return { ok: true, j }
  }
  let pick = -1
  for (let j = 0; j < lapsB.lap.length; j++) {
    const cross = lapsB.crossMs[j]!
    if (!(cross > 0 && cross <= startA && cross <= now)) continue
    if (lapsB.kind[j]! & LAP_FIRST) continue
    if (mode === 'last') {
      if (pick < 0 || cross > lapsB.crossMs[pick]!) pick = j
      continue
    }
    const ms = lapsB.lapMs[j]!
    if (!(ms > 0) || lapFlagsAt(lapsB, j, now) & LAP_DELETED) continue
    if (pick < 0 || ms < lapsB.lapMs[pick]!) pick = j
  }
  return pick < 0 ? { ok: false, reason: 'noLap' } : { ok: true, j: pick }
}
