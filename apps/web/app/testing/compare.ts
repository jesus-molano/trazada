/**
 * Solo para tests: una carrera sintética para la comparación de dos pilotos (ítem 1) y un runtime falso con lo que
 * piden sus componentes (TzCompare, TzTelemetry, TzLeaderboard, la capa del fantasma).
 *
 * Vueltas de 3000 m. El coche 1 (AAA) va a 50 m/s (vueltas de 60 s), el 2 (BBB) a 40 m/s (vueltas de 75 s), el 3 (CCC)
 * tiene vueltas pero ninguna posición y el 4 (DDD) no tiene ni vueltas. Telemetría de los coches 1 y 2, una muestra
 * por segundo. Así, a los 90 s, A = 1 en su vuelta 2 frente a la vuelta 2 de B = 2 (que va por detrás) da −3,0 s.
 */
import type { DriverInfo } from '@trazada/schema'
import { buildLapTable } from '../engine/analysis/lapTable'
import type { LeaderboardRow } from '../engine/leaderboard/leaderboard'
import { fakeTrzb } from './fixture'
import { timingBuilder } from './laps'
import { constantSpeed, syntheticTracks } from './motion'
import { withExt } from './runtime'

export const COMPARE_TEST_LAP_M = 3000

export const compareTestDriver = (number: string, tla: string): DriverInfo => ({
  number,
  tla,
  first: 'Piloto',
  last: tla.charAt(0) + tla.slice(1).toLowerCase(),
  team: '',
  // Sin color de equipo (aquí no hace falta, y en app/ no puede haber literales de color fuera de tokens.css).
  color: '',
})

const DRIVERS = [
  compareTestDriver('1', 'AAA'),
  compareTestDriver('2', 'BBB'),
  compareTestDriver('3', 'CCC'),
  compareTestDriver('4', 'DDD'),
]

/** Telemetría de los coches dados, una muestra por segundo de 0 a `toMs`. */
function carTelemetry(cars: number[], toMs: number) {
  const t: number[] = []
  const car: number[] = []
  const start: number[] = []
  const count: number[] = []
  for (const c of cars) {
    car.push(c)
    start.push(t.length)
    let n = 0
    for (let x = 0; x <= toMs; x += 1000, n++) t.push(x)
    count.push(n)
  }
  return fakeTrzb('car', {
    cars: { car, start, count },
    tel: {
      t,
      speed: t.map(() => 200),
      rpm: t.map(() => 10_000),
      gear: t.map(() => 7),
      throttle: t.map(() => 90),
      brake: t.map(() => 0),
      drs: t.map(() => 255),
    },
  })
}

/** Fila de la clasificación (para TzLeaderboard). */
export function compareTestRow(car: string, position: number): LeaderboardRow {
  return {
    car,
    driver: DRIVERS.find((d) => d.number === car) ?? null,
    position,
    positionKnown: true,
    gapMs: null,
    intervalMs: null,
    lapsBehind: 0,
    lap: 2,
    compound: 'MEDIUM',
    tyreLife: null,
    bestLapMs: null,
    inPit: false,
    noSignal: false,
    blueFlag: false,
  }
}

/**
 * Runtime falso de la carrera sintética. `frame(t)` hace lo que el bucle del runtime: llama a los oyentes de frame
 * (paneles) con ese instante.
 */
export function compareTestRuntime() {
  const timing = timingBuilder()
    .run(1, 0, [60_000, 60_000, 60_000, 60_000])
    .run(2, 0, [75_000, 75_000, 75_000])
    .run(3, 0, [70_000, 70_000])
    .build()
  const tracks = syntheticTracks([
    constantSpeed(1, { fromMs: 0, toMs: 250_000, stepMs: 250, speedMps: 50 }),
    constantSpeed(2, { fromMs: 0, toMs: 250_000, stepMs: 250, speedMps: 40 }),
  ])
  const listeners = new Set<(t: number) => void>()
  const clock = { timeMs: 0, playing: false, rate: 1, startMs: 0, endMs: 250_000 }
  const rt = withExt({
    session: {
      manifest: {
        session: { type: 'race', season: 2025, playback: { startMs: 0, endMs: 250_000, lightsOutMs: null } },
        channels: { drs: 'present' },
        quality: { estimated: [] as string[] },
      },
      car: carTelemetry([1, 2], 250_000),
      timing,
      events: { raceControl: [] },
    },
    model: { tracks, states: [] },
    leaderboard: {
      race: true,
      lapTable: buildLapTable('race', timing, []),
      compute: () => DRIVERS.slice(0, 3).map((d, i) => compareTestRow(d.number, i + 1)),
    },
    circuit: { centerline: { length: COMPARE_TEST_LAP_M } },
    drivers: DRIVERS,
    clock,
    onFrame: (cb: (t: number) => void) => (listeners.add(cb), () => listeners.delete(cb)),
    onCoarse: (cb: (s: { timeMs: number; playing: boolean; rate: 1 }) => void) => {
      cb({ timeMs: clock.timeMs, playing: false, rate: 1 })
      return () => {}
    },
    requestFrame: () => {},
    dispose: () => {},
  })
  return {
    rt,
    frame(t: number) {
      clock.timeMs = t
      for (const l of [...listeners]) l(t)
    },
  }
}
