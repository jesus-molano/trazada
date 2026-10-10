/**
 * Solo para tests: pistas de movimiento y circuitos sintéticos. Las pistas pasan por el mismo código que las
 * reales (`computeTangents` y `carTracks` sobre un `motion` decodificado), así que sus segmentos, tangentes y
 * huecos son los de la aplicación.
 */
import type { DecodedTrzb } from '@trazada/schema'
import { type CarTrack, carTracks, computeTangents, PATH_TRACK } from '../engine/replay/motion'
import type { CircuitMeta, CircuitModel } from '../engine/track/circuit'
import { TrackPath } from '../engine/track/TrackPath'
import { fakeTrzb } from './fixture'

export interface TrackSpec {
  car: number
  t: readonly number[]
  /** Distancia acumulada (m). Con `path` 2 (sin dato), el valor no se usa (el pipeline pone 0). */
  s: readonly number[]
  /** 0 pista (por defecto), 1 pit, 2 sin dato. */
  path?: readonly number[]
}

/** `motion` decodificado con los coches dados (filas ordenadas por coche y tiempo, como el del pipeline). */
export function fakeMotion(specs: readonly TrackSpec[]): DecodedTrzb {
  const t: number[] = []
  const s: number[] = []
  const path: number[] = []
  const car: number[] = []
  const start: number[] = []
  const count: number[] = []
  for (const sp of specs) {
    if (sp.s.length !== sp.t.length || (sp.path && sp.path.length !== sp.t.length)) throw new RangeError('longitudes')
    car.push(sp.car)
    start.push(t.length)
    count.push(sp.t.length)
    t.push(...sp.t)
    s.push(...sp.s)
    path.push(...(sp.path ?? sp.t.map(() => PATH_TRACK)))
  }
  return fakeTrzb('motion', {
    cars: { car, start, count },
    pos: { t, s, path, projErr: t.map(() => 0) },
  })
}

/** Pistas de movimiento (con tangentes PCHIP) de los coches dados. */
export function syntheticTracks(specs: readonly TrackSpec[]): CarTrack[] {
  const motion = fakeMotion(specs)
  return carTracks(motion, computeTangents(motion, null, 'pchip'))
}

export function syntheticTrack(spec: TrackSpec): CarTrack {
  return syntheticTracks([spec])[0]!
}

/** Muestras cada `stepMs` desde `fromMs` hasta `toMs` (incluido) a velocidad constante desde `s0`. */
export function constantSpeed(
  car: number,
  opts: { fromMs: number; toMs: number; stepMs: number; speedMps: number; s0?: number },
): TrackSpec {
  const t: number[] = []
  const s: number[] = []
  for (let x = opts.fromMs; x <= opts.toMs; x += opts.stepMs) {
    t.push(x)
    s.push((opts.s0 ?? 0) + (opts.speedMps * (x - opts.fromMs)) / 1000)
  }
  return { car, t, s }
}

/**
 * Circuito sintético: la línea central es un polígono regular de `vertices` lados y radio `radius` (centrado,
 * en sentido antihorario, s = 0 en (radius, 0)); el pit lane, opcional, una recta de `pit.lengthM` dentro del
 * círculo que va de la entrada a la salida (en s equivalente de pista).
 */
export function ringCircuit(
  opts: { radius?: number; vertices?: number; pit?: { entryS: number; exitS: number; lengthM: number } } = {},
): CircuitModel {
  const radius = opts.radius ?? 500
  const n = opts.vertices ?? 720
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n
    xs.push(radius * Math.cos(a))
    ys.push(radius * Math.sin(a))
  }
  const centerline = new TrackPath(xs, ys, new Array<number>(n).fill(0), true)
  let pitlane: TrackPath | null = null
  if (opts.pit) {
    const y = -0.8 * radius
    const half = opts.pit.lengthM / 2
    pitlane = new TrackPath([-half, 0, half], [y, y, y], [0, 0, 0], false)
  }
  const meta: CircuitMeta = {
    circuitId: 'ring',
    name: 'Ring',
    lengthM: centerline.length,
    rotationDeg: 0,
    pit: opts.pit ?? null,
    quality: {},
    sources: ['test'],
  }
  return {
    meta,
    centerline,
    pitlane,
    corners: [],
    marshalSectors: [],
    extent: radius,
    radius,
    zRange: [0, 0],
  }
}
