/**
 * Solo para tests: una sesión sintética para el mapa de calor (ítem 2) y un runtime falso con lo que piden su store,
 * su herramienta y las demás herramientas de la escena.
 *
 * Circuito en anillo de ~3142 m (720 vértices, s = 0 en la línea de meta). Cada coche va a velocidad constante desde
 * la línea en t = 0, con posiciones cada 250 ms y telemetría a 4 Hz (desfasada 100 ms) cuya velocidad «medida» es la
 * de `heatTestKmh`: de 100 km/h en la línea a 300 km/h justo antes (diente de sierra), así cada punto de la vuelta
 * tiene una velocidad conocida. Se pueden quitar ventanas de posición o de telemetría (huecos).
 */
import type { DecodedTrzb, DriverInfo, SessionType } from '@trazada/schema'
import { buildLapTable } from '../engine/analysis/lapTable'
import type { HeatSource } from '../engine/track/heat'
import { fakeTrzb } from './fixture'
import { type LapInput, timingBuilder } from './laps'
import { ringCircuit, syntheticTracks, type TrackSpec } from './motion'
import { withExt } from './runtime'

export const heatTestCircuit = ringCircuit({ radius: 500, vertices: 720 })
export const HEAT_TEST_L = heatTestCircuit.centerline.length

/** Velocidad «medida» (km/h) en la distancia acumulada s. */
export const heatTestKmh = (s: number) => 100 + 200 * ((((s % HEAT_TEST_L) + HEAT_TEST_L) % HEAT_TEST_L) / HEAT_TEST_L)

export interface HeatTestCar {
  car: number
  /** Velocidad (m/s) constante: s = 0 en la línea en t = 0. */
  mps: number
  /** Vueltas (la 1 empieza en t = 0). Por defecto, 5. */
  laps?: number
  /** Ventanas [desde, hasta) sin posición (ms). */
  posHoles?: [number, number][]
  /** Ventanas [desde, hasta) sin muestras de telemetría (ms). */
  telHoles?: [number, number][]
  each?: (i: number) => LapInput
}

/** Duración de cada vuelta del coche (ms). */
export const heatTestLapMs = (c: Pick<HeatTestCar, 'mps'>) => (HEAT_TEST_L / c.mps) * 1000

const lastMs = (c: HeatTestCar) => heatTestLapMs(c) * (c.laps ?? 5) + 3000
const inside = (holes: [number, number][] | undefined, t: number) => (holes ?? []).some(([a, b]) => t >= a && t < b)

function motionSpec(c: HeatTestCar): TrackSpec {
  const t: number[] = []
  const s: number[] = []
  for (let x = 0; x <= lastMs(c); x += 250) {
    if (inside(c.posHoles, x)) continue
    t.push(x)
    s.push((c.mps * x) / 1000)
  }
  return { car: c.car, t, s }
}

function telemetry(cars: readonly HeatTestCar[]): DecodedTrzb {
  const t: number[] = []
  const car: number[] = []
  const start: number[] = []
  const count: number[] = []
  const speed: number[] = []
  for (const c of cars) {
    car.push(c.car)
    start.push(t.length)
    let n = 0
    for (let x = 100; x <= lastMs(c); x += 250) {
      if (inside(c.telHoles, x)) continue
      t.push(x)
      speed.push(heatTestKmh((c.mps * x) / 1000))
      n++
    }
    count.push(n)
  }
  const zeros = t.map(() => 0)
  return fakeTrzb('car', {
    cars: { car, start, count },
    tel: { t, speed, rpm: zeros, gear: zeros, throttle: zeros, brake: zeros, drs: t.map(() => 255) },
  })
}

/** Lo que pide el mapa de calor (`createHeat`) para estos coches. */
export function heatTestSource(cars: readonly HeatTestCar[], type: SessionType = 'fp1') {
  const b = timingBuilder()
  for (const c of cars) b.run(c.car, 0, new Array<number>(c.laps ?? 5).fill(heatTestLapMs(c)), { each: c.each })
  const timing = b.build()
  const tracks = syntheticTracks(cars.map(motionSpec))
  const source: HeatSource = {
    session: { manifest: { session: { type } }, car: telemetry(cars) },
    model: { tracks },
    leaderboard: { lapTable: buildLapTable(type, timing, []) },
    circuit: { centerline: heatTestCircuit.centerline },
  }
  return { ...source, timing }
}

const driver = (number: string, tla: string): DriverInfo => ({
  number,
  tla,
  first: 'Piloto',
  last: tla.charAt(0) + tla.slice(1).toLowerCase(),
  team: '',
  color: '',
})

/**
 * Runtime falso con dos coches que no están en el fixture e2e (2 = BBB a 50 m/s, 7 = GGG a 48 m/s: BBB gana todos
 * los minisectores por ~105 ms), para los tests de componentes. `coarse(t)` hace lo que el reloj grueso del runtime.
 */
export function heatTestRuntime(type: SessionType = 'race') {
  const cars: HeatTestCar[] = [
    { car: 2, mps: 50 },
    { car: 7, mps: 48 },
  ]
  const src = heatTestSource(cars, type)
  const coarse = new Set<(s: { timeMs: number; playing: boolean; rate: 1 }) => void>()
  const clock = { timeMs: 0, playing: false, rate: 1, startMs: 0, endMs: 400_000 }
  const rt = withExt({
    session: {
      manifest: {
        session: { type, season: 2025, playback: { startMs: 0, endMs: 400_000, lightsOutMs: null } },
        quality: { estimated: [] as string[] },
      },
      car: src.session.car,
      timing: src.timing,
      events: { raceControl: [], windows: [] },
    },
    model: src.model,
    leaderboard: { lapTable: src.leaderboard.lapTable },
    circuit: heatTestCircuit,
    drivers: [driver('2', 'BBB'), driver('7', 'GGG')],
    clock,
    onFrame: () => () => {},
    onCoarse: (cb: (s: { timeMs: number; playing: boolean; rate: 1 }) => void) => {
      coarse.add(cb)
      cb({ timeMs: clock.timeMs, playing: false, rate: 1 })
      return () => coarse.delete(cb)
    },
    requestFrame: () => {},
    dispose: () => {},
  })
  return {
    rt,
    /** Lleva el reloj grueso a t (como un seek en pausa). */
    coarse(t: number) {
      clock.timeMs = t
      for (const cb of [...coarse]) cb({ timeMs: t, playing: false, rate: 1 })
    },
    /** Instante en que la vuelta n (1…) del coche ya cuenta (su paso por meta más 2 s). */
    seen: (car: 2 | 7, lap: number) => heatTestLapMs(cars.find((c) => c.car === car)!) * lap + 2001,
  }
}
