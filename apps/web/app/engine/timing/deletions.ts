/**
 * Cuándo se anula cada vuelta anulada. La columna `deleted` de la tabla de vueltas dice qué vueltas acabaron
 * anuladas, pero no cuándo: el mensaje de dirección de carrera («CAR 12 (ANT) TIME 1:49.320 DELETED - …») llega
 * segundos o minutos después del final de la vuelta, y hasta entonces la vuelta cuenta (la torre oficial también
 * la cuenta). Para cada vuelta anulada se busca su mensaje `lap_deleted` del mismo coche, posterior al final de la
 * vuelta:
 *
 * 1. el que cita su tiempo (`TIME m:ss.sss` = lapMs, ±1 ms; el número de vuelta del texto no coincide siempre con
 *    el de la tabla de vueltas);
 * 2. si ninguno lo cita, el primero sin tiempo en el texto («LAP DELETED …») que quede sin asignar (uno que cita
 *    otro tiempo es de otra vuelta);
 * 3. sin mensaje, desde el final de la vuelta (el dato dice que se anuló, pero no cuándo).
 *
 * Las restituciones (`lap_reinstated`) no se modelan: la columna ya trae el estado final.
 */
import type { RaceControlEvent } from '@trazada/schema'

const TIME_RX = /\bTIME\s+(\d{1,2}):(\d{2})\.(\d{3})\b/

/** Tiempo de vuelta citado en el texto de un mensaje («TIME 1:49.320» → 109320), o null. */
export function quotedLapMs(text: string): number | null {
  const m = TIME_RX.exec(text)
  return m ? Number(m[1]) * 60_000 + Number(m[2]) * 1000 + Number(m[3]) : null
}

/** Las columnas de la tabla de vueltas que hacen falta (`lapsView` las da). */
export interface DeletionLaps {
  rows: number
  car: ArrayLike<number>
  endMs: ArrayLike<number>
  lapMs: ArrayLike<number>
  deleted: ArrayLike<number>
}

/**
 * Para cada fila de la tabla de vueltas, el instante (ms de sesión) desde el que la vuelta está anulada, o
 * Infinity si no se anuló.
 */
export function deletionTimes(laps: DeletionLaps, raceControl: readonly RaceControlEvent[]): Float64Array {
  const out = new Float64Array(laps.rows).fill(Infinity)
  const messages = raceControl.filter((e) => e.parsed.kind === 'lap_deleted').sort((a, b) => a.t - b.t)
  const carsOf = (e: RaceControlEvent) => (e.parsed.cars.length ? e.parsed.cars : e.car ? [e.car] : [])
  const rows: number[] = []
  for (let i = 0; i < laps.rows; i++) if (laps.deleted[i]) rows.push(i)
  rows.sort((a, b) => laps.endMs[a]! - laps.endMs[b]!)
  const used = new Set<RaceControlEvent>()
  const candidates = (i: number) => {
    const car = String(laps.car[i])
    const end = laps.endMs[i]!
    return messages.filter((e) => !used.has(e) && e.t >= end && carsOf(e).includes(car))
  }
  // 1. El mensaje que cita el tiempo de la vuelta.
  const pending: number[] = []
  for (const i of rows) {
    const ms = laps.lapMs[i]!
    const exact = ms > 0 ? candidates(i).find((e) => Math.abs((quotedLapMs(e.text) ?? -1e9) - ms) <= 1) : undefined
    if (exact) {
      used.add(exact)
      out[i] = exact.t
    } else pending.push(i)
  }
  // 2. El primero sin tiempo citado que quede del mismo coche; 3. sin mensaje, el final de la vuelta.
  for (const i of pending) {
    const next = candidates(i).find((e) => quotedLapMs(e.text) === null)
    if (next) used.add(next)
    out[i] = next ? next.t : Math.max(0, laps.endMs[i]!)
  }
  return out
}
