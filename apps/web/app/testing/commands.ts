/**
 * Solo para tests: el contexto de la paleta de comandos (ítem 14) con una carrera y unos libres sintéticos, y unos
 * servicios que apuntan lo que se les pide (sin vitest: cada llamada queda en `calls` como texto).
 *
 * Carrera (`raceTiming`): reproducción de 0 a 600 s, salida a 60 s (el reloj visible empieza ahí), 5 vueltas. NOR (1)
 * y VER (3) dan vueltas desde la salida; NOR para en boxes en la vuelta 3 (entra a 330 s). Coche de seguridad de 200
 * a 260 s, amarilla en el sector 4 a 400 s y bandera a cuadros a 560 s.
 *
 * Libres (`practiceTiming`): de 0 a 600 s, la sesión empieza («Started») a 10 s. NOR da 3 vueltas desde 20 s; VER, 2,
 * con el inicio de la segunda sin dato.
 */
import type { DecodedTrzb, DriverInfo, SessionEvents, SessionType } from '@trazada/schema'
import { buildLapTable } from '../engine/analysis/lapTable'
import type { Rate } from '../engine/clock/SessionClock'
import type { CommandContext, CommandServices, CommandSessionInfo, CommandState } from '../engine/commands/types'
import { buildTimelineMarkers, clockOrigin } from '../engine/timeline/markers'
import { rcMessage, sessionEvents, timingBuilder } from './laps'

export const paletteDriver = (number: string, tla: string, first: string, last: string): DriverInfo => ({
  number,
  tla,
  first,
  last,
  team: '',
  // Sin color (en app/ no puede haber literales de color fuera de tokens.css).
  color: '',
})

export const PALETTE_DRIVERS: readonly DriverInfo[] = [
  paletteDriver('1', 'NOR', 'Lando', 'Norris'),
  paletteDriver('3', 'VER', 'Max', 'Verstappen'),
  paletteDriver('81', 'PIA', 'Oscar', 'Piastri'),
  paletteDriver('55', 'SAI', 'Carlos', 'Sainz'),
  paletteDriver('2', 'SAR', 'Logan', 'Sargeant'),
  paletteDriver('11', 'PER', 'Sergio', 'Pérez'),
  paletteDriver('27', 'HUL', 'Nico', 'Hülkenberg'),
  paletteDriver('30', 'LAW', 'Liam', 'Lawson'),
]

export function raceTiming(): DecodedTrzb {
  return timingBuilder()
    .run(1, 60_000, [95_000, 90_000, 90_000, 90_000, 90_000], {
      lap1NoTime: true,
      each: (i) => (i === 2 ? { pitInMs: 330_000 } : i === 3 ? { pitOutMs: 352_000 } : {}),
    })
    .run(3, 60_000, [96_000, 91_000, 91_000, 91_000, 91_000], { lap1NoTime: true })
    .build()
}

export function raceEvents(): SessionEvents {
  return sessionEvents({
    windows: [{ kind: 'sc', fromMs: 200_000, toMs: 260_000 }],
    raceControl: [
      { ...rcMessage(400_000, 'sector_yellow'), sector: 4 },
      rcMessage(560_000, 'chequered_flag'),
    ],
  })
}

export function practiceTiming(): DecodedTrzb {
  return timingBuilder()
    .sessionStatus(10_000, 'Started')
    .run(1, 20_000, [100_000, 95_000, 120_000])
    .lap(3, 1, { startMs: 30_000, endMs: 130_000, lapMs: 100_000 })
    .lap(3, 2, { endMs: 230_000, lapMs: 100_000 })
    .build()
}

export interface PaletteContextOptions {
  type?: SessionType
  timing?: DecodedTrzb
  events?: SessionEvents
  drivers?: readonly DriverInfo[]
  startMs?: number
  endMs?: number
  lightsOutMs?: number | null
  totalLaps?: number | null
  defaultMs?: number
  state?: Partial<CommandState>
  services?: Partial<CommandServices>
}

/** La información fija de una sesión sintética (por defecto, la carrera). */
export function paletteSession(o: PaletteContextOptions = {}): CommandSessionInfo {
  const type = o.type ?? 'race'
  const race = type === 'race' || type === 'sprint'
  const timing = o.timing ?? (race ? raceTiming() : practiceTiming())
  const events = o.events ?? (race ? raceEvents() : sessionEvents())
  const playback = {
    startMs: o.startMs ?? 0,
    endMs: o.endMs ?? 600_000,
    lightsOutMs: o.lightsOutMs !== undefined ? o.lightsOutMs : race ? 60_000 : null,
  }
  return {
    type,
    race,
    drivers: o.drivers ?? PALETTE_DRIVERS,
    startMs: playback.startMs,
    endMs: playback.endMs,
    originMs: clockOrigin(type, timing, playback),
    defaultMs: o.defaultMs ?? (playback.lightsOutMs !== null ? playback.lightsOutMs - 5000 : playback.startMs),
    totalLaps: o.totalLaps !== undefined ? o.totalLaps : race ? 5 : null,
    markers: buildTimelineMarkers(type, timing, events, playback.endMs),
    laps: buildLapTable(type, timing, events.raceControl),
  }
}

/** Servicios que apuntan cada llamada en `calls` («seek:330000», «select:1», «follow:true»…). */
export function recordingServices(over: { comparing?: string | null; resumedMs?: number | null } = {}) {
  const calls: string[] = []
  const services: CommandServices = {
    playback: {
      play: () => calls.push('play'),
      pause: () => calls.push('pause'),
      setRate: (r: Rate) => calls.push(`rate:${r}`),
      seek: (t: number) => calls.push(`seek:${t}`),
      select: (car: string | null) => calls.push(`select:${car}`),
      follow: (on: boolean) => calls.push(`follow:${on}`),
    },
    compare: {
      comparing: over.comparing ?? null,
      compare: (a: string, b: string) => calls.push(`compare:${a}:${b}`),
      close: () => calls.push('compare:close'),
    },
    resume: { resumedMs: over.resumedMs ?? null },
    moments: { list: () => [] },
  }
  return { calls, services }
}

/** Un contexto completo: la sesión sintética, el estado (en pausa a ×1, sin selección) y los servicios dados. */
export function paletteContext(o: PaletteContextOptions = {}): CommandContext {
  const session = paletteSession(o)
  return {
    session,
    state: {
      timeMs: 100_000,
      playing: false,
      rate: 1,
      selectedCar: null,
      following: false,
      order: session.drivers.map((d) => d.number),
      ...o.state,
    },
    services: o.services ?? withoutMoments(recordingServices().services),
  }
}

/**
 * Los servicios sin el de momentos (ítem 5; en la app lo registran los botones de salto del dock): los comandos de
 * momentos no se ofrecen.
 */
export function withoutMoments(services: CommandServices): Partial<CommandServices> {
  const { moments: _moments, ...rest } = services
  return rest
}
