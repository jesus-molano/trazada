/**
 * Leaderboard en el instante t, solo con datos reales de cronometraje:
 *
 * - Posición: la de la torre oficial (stream del live timing) si existe. Si no, en carrera, el orden en la
 *   línea (vueltas completadas, y a igualdad, quién cruzó antes); en el resto de sesiones, la mejor vuelta.
 * - Gap e intervalo: los de la torre; si faltan, los tiempos de paso por la línea (carrera) o la
 *   diferencia de mejor vuelta (resto).
 * - Neumático: compuesto y edad de la vuelta en curso (tabla de vueltas).
 */
import { ENUMS, type DecodedTrzb, type DriverInfo, type SessionEvents, type SessionType } from '@trazada/schema'
import { lapsView } from '../data/columns'
import type { CarState } from '../replay/ReplayModel'

/** Una bandera azul se muestra este tiempo después del mensaje (los mensajes son instantáneos). */
export const BLUE_FLAG_MS = 8000

export interface LeaderboardRow {
  car: string
  driver: DriverInfo | null
  position: number
  /** ms al líder (o a la mejor vuelta); null = sin dato. */
  gapMs: number | null
  intervalMs: number | null
  lapsBehind: number
  /** Vuelta en curso (1…) o 0 antes de empezar. */
  lap: number
  compound: string
  tyreLife: number | null
  bestLapMs: number | null
  inPit: boolean
  noSignal: boolean
  blueFlag: boolean
}

interface CarLaps {
  lap: Int32Array
  start: Float64Array
  end: Float64Array
  lapMs: Float64Array
  compound: Uint8Array
  tyreLife: Uint8Array
  deleted: Uint8Array
  pitIn: Float64Array
  pitOut: Float64Array
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
  private readonly laps = new Map<string, CarLaps>()
  private readonly stream = new Map<string, StreamRows>()
  private readonly hasStream: boolean
  private readonly blue: { t: number; cars: string[] }[]

  constructor(
    type: SessionType,
    timing: DecodedTrzb,
    events: SessionEvents,
    private readonly drivers: DriverInfo[],
  ) {
    this.race = type === 'race' || type === 'sprint'
    const v = lapsView(timing)
    const rows = new Map<string, number[]>()
    for (let i = 0; i < v.rows; i++) {
      const car = String(v.car[i])
      ;(rows.get(car) ?? rows.set(car, []).get(car)!).push(i)
    }
    const tyreLife = timing.tables.laps!.columns.tyreLife!
    // Una "vuelta" mucho más corta que lo normal no es un paso por meta (p. ej. el registro residual de un
    // coche retirado): no cuenta como vuelta completada.
    const durations = Array.from({ length: v.rows }, (_, i) => v.lapMs[i]!).filter((ms) => ms > 0).sort((a, b) => a - b)
    const minLapMs = durations.length ? 0.5 * durations[durations.length >> 1]! : 0
    const realEnd = (i: number) => (v.endMs[i]! > 0 && v.endMs[i]! - v.startMs[i]! >= minLapMs ? v.endMs[i]! : -1)
    for (const [car, idx] of rows) {
      idx.sort((a, b) => v.lap[a]! - v.lap[b]!)
      const pick = (col: ArrayLike<number>) => idx.map((i) => col[i]!)
      this.laps.set(car, {
        lap: Int32Array.from(pick(v.lap)),
        start: Float64Array.from(pick(v.startMs)),
        end: Float64Array.from(idx, realEnd),
        lapMs: Float64Array.from(pick(v.lapMs)),
        compound: Uint8Array.from(pick(v.compound)),
        tyreLife: Uint8Array.from(pick(tyreLife)),
        deleted: Uint8Array.from(pick(v.deleted)),
        pitIn: Float64Array.from(pick(v.pitInMs)),
        pitOut: Float64Array.from(pick(v.pitOutMs)),
      })
    }

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
    for (let j = 0; j < laps.lap.length; j++) if (laps.start[j]! >= 0 && laps.start[j]! <= t) k = j
    if (k < 0) return 'UNKNOWN'
    const c = laps.compound[k]!
    const n = laps.lap.length
    // Vuelta de entrada: ya en el pit, antes de cruzar la línea.
    if (k + 1 < n && laps.compound[k + 1] !== c && laps.pitIn[k]! >= 0 && t >= laps.pitIn[k]!) return 'UNKNOWN'
    // Vuelta de salida: aún sin salir del pit.
    if (k > 0 && laps.compound[k - 1] !== c && laps.pitOut[k]! >= 0 && t < laps.pitOut[k]!) return 'UNKNOWN'
    return ENUMS.compound[c] ?? 'UNKNOWN'
  }

  compute(t: number, states: readonly CarState[]): LeaderboardRow[] {
    const blue = this.blueFlagsAt(t)
    const stateOf = new Map(states.map((s) => [s.car, s]))
    const rows: (LeaderboardRow & { _done: number; _cross: number; _s: number })[] = []
    for (const d of this.drivers) {
      const st = stateOf.get(d.number)
      const laps = this.laps.get(d.number)
      let done = 0
      let cross = Infinity
      let lap = 0
      let compound = 'UNKNOWN'
      let tyreLife: number | null = null
      let best: number | null = null
      if (laps) {
        // Vueltas completadas en t y vuelta en curso
        for (let k = 0; k < laps.lap.length; k++) {
          const end = laps.end[k]!
          if (end > 0 && end <= t) {
            done = laps.lap[k]!
            cross = end
            const ms = laps.lapMs[k]!
            if (ms > 0 && !laps.deleted[k] && (best === null || ms < best)) best = ms
          }
          if (laps.start[k]! >= 0 && laps.start[k]! <= t) {
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
        gapMs: null,
        intervalMs: null,
        lapsBehind: 0,
        lap,
        compound,
        tyreLife,
        bestLapMs: best,
        inPit: !!st?.visible && st.inPit,
        noSignal: !st?.visible,
        blueFlag: blue.has(d.number),
        _done: done,
        _cross: cross,
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
    return rows.map(({ _done, _cross, _s, ...r }) => r)
  }

  private applyStream(t: number, rows: (LeaderboardRow & { _s: number })[]): void {
    for (const r of rows) {
      const st = this.stream.get(r.car)
      if (!st) continue
      const i = lastAtOrBefore(st.t, t)
      if (i < 0) continue
      r.position = st.position[i]!
      r.gapMs = st.gap[i]! >= 0 ? st.gap[i]! : null
      r.intervalMs = st.interval[i]! >= 0 ? st.interval[i]! : null
      r.lapsBehind = st.lapsBehind[i]!
    }
  }

  /** Carrera sin torre: orden en la línea de meta y gaps con los tiempos de paso. */
  private orderAtLine(rows: (LeaderboardRow & { _done: number; _cross: number; _s: number })[]): void {
    rows.sort((a, b) => b._done - a._done || a._cross - b._cross || b._s - a._s)
    const leader = rows[0]
    rows.forEach((r, i) => {
      r.position = i + 1
      if (!leader || r._done === 0) return
      r.lapsBehind = leader._done - r._done
      const leaderCross = this.crossingOf(leader.car, r._done)
      r.gapMs = r.lapsBehind === 0 && leaderCross !== null ? r._cross - leaderCross : null
      const ahead = rows[i - 1]
      if (ahead) {
        const aheadCross = this.crossingOf(ahead.car, r._done)
        r.intervalMs = aheadCross !== null ? r._cross - aheadCross : null
      }
    })
    if (leader && leader._done > 0) {
      leader.gapMs = 0
      leader.intervalMs = null
    }
  }

  private crossingOf(car: string, lap: number): number | null {
    const laps = this.laps.get(car)
    if (!laps) return null
    for (let k = 0; k < laps.lap.length; k++) if (laps.lap[k] === lap && laps.end[k]! > 0) return laps.end[k]!
    return null
  }

  /** Libres y clasificación sin torre: orden por mejor vuelta hasta t. */
  private orderByBestLap(rows: (LeaderboardRow & { _s: number })[]): void {
    rows.sort((a, b) => (a.bestLapMs ?? Infinity) - (b.bestLapMs ?? Infinity) || b._s - a._s)
    rows.forEach((r, i) => (r.position = i + 1))
    this.bestLapGaps(rows)
  }

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
