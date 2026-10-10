/**
 * Dónde se dibuja un coche en el circuito canónico a partir de su `path` y su `s` (TS puro, sin Vue ni three).
 * Es la lógica de `ReplayModel`, compartida para que cualquier otra figura sobre el circuito (p. ej. un coche
 * fantasma) se coloque exactamente igual que los coches:
 *
 * - En pista, la línea central en s (con envoltura en s = 0).
 * - En el pit lane, la fracción recorrida del tramo entrada→salida (`meta.pit`, en s equivalente de pista)
 *   llevada a la longitud del pit lane. Sin pit lane o sin tramo de pit, la línea central.
 * - En una transición pista↔pit (`CarSample.state === 'transition'`), la recta entre la última muestra de un
 *   camino y la primera del otro.
 */
import type { CircuitModel } from '../track/circuit'
import { newSample, type PathSample } from '../track/TrackPath'
import { type CarSample, type CarTrack, PATH_PIT } from './motion'

/** Longitud (m de pista) del tramo de s que cubre el pit lane, de la entrada a la salida; 0 sin pit. */
export function pitSpan(circuit: CircuitModel): number {
  const pit = circuit.meta.pit
  if (!pit) return 0
  const L = circuit.centerline.length
  return (((pit.exitS - pit.entryS) % L) + L) % L
}

/**
 * Punto canónico (y tangente) de un coche con `path` y `s` dados. `span` es `pitSpan(circuit)`; quien coloca
 * muchos puntos por frame lo calcula una vez y lo pasa.
 */
export function placeOnCircuit(
  circuit: CircuitModel,
  path: number,
  s: number,
  out: PathSample,
  span = pitSpan(circuit),
): PathSample {
  const { centerline, pitlane, meta } = circuit
  if (path === PATH_PIT && pitlane && meta.pit && span > 0) {
    const L = centerline.length
    const rel = (((s - meta.pit.entryS) % L) + L) % L
    const f = Math.min(1, Math.max(0, rel / span))
    return pitlane.sample(f * pitlane.length, out)
  }
  return centerline.sample(s, out)
}

/** Posición canónica (m) y rumbo en planta (rad, desde +x). `CarState` lo cumple. */
export interface PlacedPoint {
  x: number
  y: number
  z: number
  heading: number
}

/** Muestras de trabajo de `placeSample` (para no reservar memoria por frame). */
export interface PlaceScratch {
  a: PathSample
  b: PathSample
}

export function newPlaceScratch(): PlaceScratch {
  return { a: newSample(), b: newSample() }
}

/**
 * Coloca en `out` la muestra de un coche (`sampleCar`). Devuelve false, sin tocar `out`, si está oculta (sin
 * dato en ese instante).
 */
export function placeSample(
  circuit: CircuitModel,
  track: CarTrack,
  smp: CarSample,
  out: PlacedPoint,
  scratch: PlaceScratch,
  span = pitSpan(circuit),
): boolean {
  if (smp.state === 'hidden') return false
  const { a, b } = scratch
  if (smp.state === 'visible') {
    placeOnCircuit(circuit, smp.path, smp.s, a, span)
    out.x = a.x
    out.y = a.y
    out.z = a.z
    out.heading = Math.atan2(a.ty, a.tx)
    return true
  }
  // Transición pista↔pit: recta entre el último punto de un camino y el primero del otro.
  const i = smp.i
  placeOnCircuit(circuit, track.path[i]!, track.s[i]!, a, span)
  placeOnCircuit(circuit, track.path[i + 1]!, track.s[i + 1]!, b, span)
  const f = smp.f
  out.x = a.x + f * (b.x - a.x)
  out.y = a.y + f * (b.y - a.y)
  out.z = a.z + f * (b.z - a.z)
  const dx = b.x - a.x
  const dy = b.y - a.y
  out.heading = Math.hypot(dx, dy) > 0.5 ? Math.atan2(dy, dx) : Math.atan2(a.ty, a.tx)
  return true
}
