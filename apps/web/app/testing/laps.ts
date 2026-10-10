/**
 * Solo para tests: constructor de un `timing` sintético completo (vueltas, torre, estado de pista y de sesión)
 * con todas las columnas del layout y sus centinelas de «sin dato», y de los eventos de dirección de carrera
 * que lo acompañan. Usa `fakeTrzb` sin modificarlo.
 */
import { type DecodedTrzb, ENUMS, type RaceControlEvent, type SessionEvents } from '@trazada/schema'
import { fakeTrzb } from './fixture'

/** Estado de pista durante una vuelta: bits de `trackStatusMask` (TrackStatus 2, 4, 5, 6 y 7). */
export const LAP_STATUS_BITS = { yellow: 1, sc: 2, red: 4, vsc: 8, 'vsc-ending': 16 } as const
export type LapStatus = keyof typeof LAP_STATUS_BITS

/** Códigos de TrackStatus de la tabla `trackStatus`. */
export const TRACK_STATUS_CODES = { green: 1, yellow: 2, sc: 4, red: 5, vsc: 6, 'vsc-ending': 7 } as const
export type TrackStatusName = keyof typeof TRACK_STATUS_CODES

export interface LapInput {
  /** −1 (por defecto) = desconocido. */
  startMs?: number
  /** −1 (por defecto) = sin paso por meta. */
  endMs?: number
  /** −1 (por defecto) = sin tiempo oficial. */
  lapMs?: number
  /** Tiempos de sector (−1 = sin dato). */
  sectors?: [number, number, number]
  /** Nombre del compuesto (`ENUMS.compound`); por defecto UNKNOWN. */
  compound?: string
  /** null (por defecto) = desconocido (255). */
  tyreLife?: number | null
  /** null (por defecto) = desconocido (255). */
  fresh?: boolean | null
  stint?: number
  pitInMs?: number
  pitOutMs?: number
  /** 0 (por defecto) = no aplica. */
  position?: number
  /** Estados de pista que hubo durante la vuelta. */
  status?: LapStatus[]
  deleted?: boolean
}

export interface TowerInput {
  /** 0 = sin dato. */
  position: number
  /** −1 (por defecto) = líder o sin dato. */
  gapMs?: number
  intervalMs?: number
  lapsBehind?: number
}

interface LapRow {
  car: number
  lap: number
  input: LapInput
}

function enumCode(list: readonly string[], name: string, what: string): number {
  const i = list.indexOf(name)
  if (i < 0) throw new Error(`${what} desconocido: ${name}`)
  return i
}

export class TimingBuilder {
  private readonly laps: LapRow[] = []
  private readonly tower: (TowerInput & { t: number; car: number })[] = []
  private readonly track: { t: number; code: number }[] = []
  private readonly session: { t: number; status: number }[] = []

  /** Una vuelta. Lo que no se da queda sin dato, con el centinela del layout. */
  lap(car: number, lap: number, input: LapInput = {}): this {
    this.laps.push({ car, lap, input })
    return this
  }

  /**
   * Vueltas seguidas de un coche: la primera (`firstLap`, por defecto 1) empieza en `fromMs` y cada una dura lo
   * que dice `lapMs`. Con `lap1NoTime` (salida de carrera), la vuelta 1 no trae tiempo oficial (−1), como en el
   * live timing. `each(i)` añade o cambia campos de la i-ésima vuelta de la tanda.
   */
  run(
    car: number,
    fromMs: number,
    lapMs: readonly number[],
    opts: { firstLap?: number; lap1NoTime?: boolean; each?: (i: number) => LapInput } & Omit<
      LapInput,
      'startMs' | 'endMs' | 'lapMs'
    > = {},
  ): this {
    const { firstLap = 1, lap1NoTime = false, each, ...common } = opts
    let start = fromMs
    lapMs.forEach((ms, i) => {
      const lap = firstLap + i
      const end = start + ms
      this.lap(car, lap, {
        startMs: start,
        endMs: end,
        lapMs: lap === 1 && lap1NoTime ? -1 : ms,
        ...common,
        ...each?.(i),
      })
      start = end
    })
    return this
  }

  /** Una fila de la torre de tiempos oficial (stream) en t. */
  towerAt(t: number, car: number, input: TowerInput): this {
    this.tower.push({ t, car, ...input })
    return this
  }

  /** La torre completa en t: los coches en el orden dado, posiciones 1…N, sin gaps. */
  order(t: number, cars: readonly number[]): this {
    cars.forEach((car, i) => this.towerAt(t, car, { position: i + 1 }))
    return this
  }

  trackStatus(t: number, status: TrackStatusName): this {
    this.track.push({ t, code: TRACK_STATUS_CODES[status] })
    return this
  }

  /** Estado de la sesión (`ENUMS.sessionStatus`: Started, Aborted, Finished, Finalised, Ends…). */
  sessionStatus(t: number, status: string): this {
    this.session.push({ t, status: enumCode(ENUMS.sessionStatus, status, 'estado de sesión') })
    return this
  }

  build(): DecodedTrzb {
    const L = this.laps
    const f = <T>(pick: (i: LapInput) => T | undefined, dflt: T) => L.map((r) => pick(r.input) ?? dflt)
    const unknownU8 = (v: number | null | undefined) => (v === null || v === undefined ? 255 : v)
    const tower = [...this.tower].sort((a, b) => a.t - b.t || a.car - b.car)
    const track = [...this.track].sort((a, b) => a.t - b.t)
    const session = [...this.session].sort((a, b) => a.t - b.t)
    return fakeTrzb('timing', {
      laps: {
        car: L.map((r) => r.car),
        lap: L.map((r) => r.lap),
        startMs: f((i) => i.startMs, -1),
        endMs: f((i) => i.endMs, -1),
        lapMs: f((i) => i.lapMs, -1),
        s1Ms: L.map((r) => r.input.sectors?.[0] ?? -1),
        s2Ms: L.map((r) => r.input.sectors?.[1] ?? -1),
        s3Ms: L.map((r) => r.input.sectors?.[2] ?? -1),
        compound: L.map((r) => enumCode(ENUMS.compound, r.input.compound ?? 'UNKNOWN', 'compuesto')),
        tyreLife: L.map((r) => unknownU8(r.input.tyreLife)),
        fresh: L.map((r) => (r.input.fresh === null || r.input.fresh === undefined ? 255 : r.input.fresh ? 1 : 0)),
        stint: f((i) => i.stint, 0),
        pitInMs: f((i) => i.pitInMs, -1),
        pitOutMs: f((i) => i.pitOutMs, -1),
        position: f((i) => i.position, 0),
        trackStatusMask: L.map((r) => (r.input.status ?? []).reduce((m, s) => m | LAP_STATUS_BITS[s], 0)),
        deleted: L.map((r) => (r.input.deleted ? 1 : 0)),
      },
      stream: {
        t: tower.map((r) => r.t),
        car: tower.map((r) => r.car),
        position: tower.map((r) => r.position),
        gapToLeaderMs: tower.map((r) => r.gapMs ?? -1),
        intervalMs: tower.map((r) => r.intervalMs ?? -1),
        lapsBehind: tower.map((r) => r.lapsBehind ?? 0),
      },
      trackStatus: { t: track.map((r) => r.t), code: track.map((r) => r.code) },
      sessionStatus: { t: session.map((r) => r.t), status: session.map((r) => r.status) },
    })
  }
}

export function timingBuilder(): TimingBuilder {
  return new TimingBuilder()
}

/** Mensaje de dirección de carrera ya interpretado (`parsed.kind`), con el texto dado. */
export function rcMessage(
  t: number,
  kind: string,
  text: string = kind.toUpperCase().replaceAll('_', ' '),
  cars: string[] = [],
): RaceControlEvent {
  return {
    t,
    lap: null,
    category: 'Other',
    flag: null,
    scope: null,
    sector: null,
    car: cars.length === 1 ? cars[0]! : null,
    text,
    parsed: { kind, cars, turn: null, lap: null },
  }
}

/** Mensaje de vuelta anulada con el formato real («CAR 1 (AAA) TIME 1:30.000 DELETED - …»). */
export function lapDeletedMessage(t: number, car: string, lapMs: number | null, tla = 'AAA'): RaceControlEvent {
  const time =
    lapMs === null
      ? 'LAP DELETED'
      : `TIME ${Math.floor(lapMs / 60_000)}:${String(Math.floor((lapMs % 60_000) / 1000)).padStart(2, '0')}.${String(lapMs % 1000).padStart(3, '0')} DELETED`
  return rcMessage(t, 'lap_deleted', `CAR ${car} (${tla}) ${time} - TRACK LIMITS`, [car])
}

/** `events.json` mínimo. */
export function sessionEvents(over: Partial<SessionEvents> = {}): SessionEvents {
  return { schema: 'trazada.events', schemaVersion: '1.0.0', raceControl: [], sectorFlags: [], windows: [], ...over }
}
