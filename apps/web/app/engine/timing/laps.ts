/**
 * Vuelta en curso y última vuelta completada de un coche, desde la tabla de vueltas (dato real).
 * La vuelta 1 de una carrera no trae tiempo oficial en el live timing: con la opción del usuario se
 * estima como fin de la vuelta 1 − salida (incluye el hueco hasta la línea desde la parrilla).
 * Una vuelta anulada se marca como tal desde el mensaje de dirección de carrera que la anula (`deletionTimes`).
 */
import type { DecodedTrzb, RaceControlEvent, SessionType } from '@trazada/schema'
import { lapsView } from '../data/columns'
import { deletionTimes } from './deletions'

export interface LapInfo {
  /** Vuelta en curso (null fuera de vuelta: antes de salir o tras terminar). */
  lap: number | null
  /** Última vuelta completada y su tiempo (null si no hay tiempo). */
  lastLap: number | null
  lastLapMs: number | null
  /** El tiempo de la última vuelta es una estimación (vuelta 1 de carrera). */
  estimated: boolean
  /** Dirección de carrera ya ha anulado la última vuelta en t. */
  deleted: boolean
}

interface Row {
  lap: number
  startMs: number
  endMs: number
  lapMs: number
  /** Desde cuándo está anulada (Infinity: no se anuló). */
  deletedFrom: number
}

export class LapTimes {
  private readonly byCar = new Map<string, Row[]>()

  constructor(
    timing: DecodedTrzb,
    private readonly type: SessionType,
    private readonly lightsOutMs: number | null,
    raceControl: readonly RaceControlEvent[] = [],
  ) {
    const v = lapsView(timing)
    const deletedFrom = deletionTimes(v, raceControl)
    for (let i = 0; i < v.rows; i++) {
      const car = String(v.car[i])
      const list = this.byCar.get(car) ?? []
      list.push({
        lap: v.lap[i]!,
        startMs: v.startMs[i]!,
        endMs: v.endMs[i]!,
        lapMs: v.lapMs[i]!,
        deletedFrom: deletedFrom[i]!,
      })
      this.byCar.set(car, list)
    }
    for (const list of this.byCar.values()) list.sort((a, b) => a.lap - b.lap)
  }

  /** ¿Puede estimarse la vuelta 1? Solo en carrera o sprint con hora de salida. */
  get canEstimateLap1(): boolean {
    return (this.type === 'race' || this.type === 'sprint') && this.lightsOutMs !== null
  }

  at(car: string, t: number, estimateLap1: boolean): LapInfo {
    const rows = this.byCar.get(car) ?? []
    let lap: number | null = null
    let last: Row | null = null
    for (const r of rows) {
      if (r.endMs >= 0 && r.endMs <= t) last = r
      else if ((r.startMs < 0 || r.startMs <= t) && t < r.endMs) lap = r.lap
    }
    if (!last) return { lap, lastLap: null, lastLapMs: null, estimated: false, deleted: false }
    const deleted = last.deletedFrom <= t
    if (last.lapMs >= 0) return { lap, lastLap: last.lap, lastLapMs: last.lapMs, estimated: false, deleted }
    if (last.lap === 1 && estimateLap1 && this.canEstimateLap1 && last.endMs > this.lightsOutMs!) {
      return { lap, lastLap: 1, lastLapMs: last.endMs - this.lightsOutMs!, estimated: true, deleted }
    }
    return { lap, lastLap: last.lap, lastLapMs: null, estimated: false, deleted }
  }
}
