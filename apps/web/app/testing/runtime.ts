/**
 * Solo para tests: piezas de un runtime falso para los componentes que piden precálculos por sesión al runtime
 * (`rt.ext`, D29) sobre el índice de vueltas de la clasificación (`rt.leaderboard.lapTable`), como los colores de
 * sector (ítem 4).
 */
import type { DecodedTrzb, RaceControlEvent, SessionType } from '@trazada/schema'
import { buildLapTable, type LapTable } from '../engine/analysis/lapTable'
import { timingBuilder } from './laps'

/** Añade a un runtime falso un `ext` memoizado como el de `createReplayRuntime`: cada factoría recibe ese objeto. */
export function withExt<R extends object>(rt: R): R & { ext<T>(key: string, factory: (rt: R) => T): T } {
  const values = new Map<string, unknown>()
  return Object.assign(rt, {
    ext<T>(key: string, factory: (r: R) => T): T {
      if (!values.has(key)) values.set(key, factory(rt))
      return values.get(key) as T
    },
  })
}

/** Índice de vueltas de un `timing` (por defecto, uno sin vueltas) para la clasificación de un runtime falso. */
export function testLapTable(
  type: SessionType = 'fp1',
  timing: DecodedTrzb = timingBuilder().build(),
  raceControl: readonly RaceControlEvent[] = [],
): LapTable {
  return buildLapTable(type, timing, raceControl)
}
