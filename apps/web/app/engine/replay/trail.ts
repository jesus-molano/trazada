/**
 * Estelas (ítem 7): los últimos segundos de cada coche (TS puro, sin Vue ni three).
 *
 * - Se muestrean en cada frame del mismo modelo de movimiento que dibuja el coche (`sampleCar` + `placeSample`),
 *   sin guardar historial: la estela es correcta justo después de un seek, de un cambio de ritmo o de una pausa, y
 *   su punta es exactamente el coche. Va sobre la línea central (o la del pit lane), como el coche: la fuente no
 *   indica en qué parte del ancho de la pista va.
 * - Se corta en los huecos: solo se dibuja el tramo continuo que acaba en el coche. Donde el coche no se dibuja
 *   (hueco de más de `SEGMENT_GAP_MS`, sin dato, garaje), la estela termina; nada se puentea.
 * - La velocidad (color por velocidad) es la última muestra cruda de telemetría con t ≤ el instante del punto y de
 *   hace como mucho `MAX_SAMPLE_AGE_MS`, sin interpolar; sin muestra, «sin dato» (gris).
 */
import type { CircuitModel } from '../track/circuit'
import { SEGMENT_GAP_MS } from '../interp/hermite'
import { MAX_SAMPLE_AGE_MS } from '../telemetry/telemetry'
import { type CarSample, type CarTrack, findInterval, newCarSample, PATH_NODATA, sampleCar } from './motion'
import { newPlaceScratch, pitSpan, type PlaceScratch, type PlacedPoint, placeSample } from './place'

/** Tiempo de sesión que cubre cada estela (ms): ~250 m a 300 km/h, a cualquier ritmo de reproducción. */
export const TRAIL_SPAN_MS = 3000
/** Puntos por estela (el último, el coche). */
export const TRAIL_POINTS = 32
/** Valores por punto en el búfer de `sampleTrail`: x, y, z (m, canónicos), rumbo (rad) e instante (ms de sesión). */
export const TRAIL_STRIDE = 5

/** Escala fija del color por velocidad (km/h): por debajo, el color lento; por encima, el rápido. */
export const TRAIL_SPEED_KMH = { min: 80, max: 330 } as const

export interface TrailOptions {
  spanMs?: number
  points?: number
}

/** Memoria de trabajo de `sampleTrail` (una por coche: su cursor acelera la búsqueda del frame siguiente). */
export interface TrailScratch {
  readonly smp: CarSample
  readonly place: PlaceScratch
  readonly pt: PlacedPoint
}

export function newTrailScratch(): TrailScratch {
  return { smp: newCarSample(), place: newPlaceScratch(), pt: { x: 0, y: 0, z: 0, heading: 0 } }
}

/**
 * ¿Se dibuja el coche en el intervalo [t_j, t_j+1) de su pista? La misma regla que `sampleCar`: dentro de un
 * segmento, si no es «sin dato»; entre segmentos, solo una transición pista↔pit sin hueco. La última muestra, si
 * tiene dato (vale solo en su instante exacto).
 */
export function intervalDrawn(track: CarTrack, j: number): boolean {
  const n = track.t.length
  if (j < 0 || j >= n) return false
  const pa = track.path[j]!
  if (pa === PATH_NODATA) return false
  if (j === n - 1) return true
  if (track.seg[j] === track.seg[j + 1]) return true
  return track.t[j + 1]! - track.t[j]! <= SEGMENT_GAP_MS && track.path[j + 1] !== PATH_NODATA
}

/** ¿Se dibuja el coche sin interrupción entre los intervalos `a` y `b` (a ≤ b), ambos incluidos? */
function continuous(track: CarTrack, a: number, b: number): boolean {
  for (let j = a; j <= b; j++) if (!intervalDrawn(track, j)) return false
  return true
}

/**
 * Estela de un coche en el instante `t` (ms de sesión): escribe en `out`, de la cola al coche, `TRAIL_STRIDE`
 * valores por punto (posición canónica y rumbo como `placeSample`, e instante del punto) y devuelve cuántos puntos
 * escribió. Los puntos van a intervalos iguales de `spanMs / (points − 1)` y el último es el coche en `t`. Si el
 * coche no se dibuja en `t`, o el tramo continuo que acaba en él tiene menos de dos puntos, 0 (sin estela).
 *
 * `out` debe tener sitio para `points × TRAIL_STRIDE` valores. `span` es `pitSpan(circuit)`, para quien coloca
 * muchas estelas por frame.
 */
export function sampleTrail(
  circuit: CircuitModel,
  track: CarTrack,
  t: number,
  out: Float64Array,
  scratch: TrailScratch,
  options: TrailOptions = {},
  span = pitSpan(circuit),
): number {
  const spanMs = options.spanMs ?? TRAIL_SPAN_MS
  const points = Math.max(2, Math.floor(options.points ?? TRAIL_POINTS))
  if (out.length < points * TRAIL_STRIDE) throw new RangeError('sampleTrail: búfer pequeño')
  const step = spanMs / (points - 1)
  const { smp, place, pt } = scratch
  let n = 0
  let prev = -1
  for (let k = 0; k < points; k++) {
    const x = k === points - 1 ? t : t - spanMs + k * step
    sampleCar(track, x, smp)
    // Un punto sin coche (o un hueco entre este punto y el anterior) corta la estela: vuelve a empezar detrás.
    if (smp.state === 'hidden' || (n > 0 && !continuous(track, prev, smp.i))) n = 0
    if (smp.state === 'hidden') continue
    placeSample(circuit, track, smp, pt, place, span)
    const o = n * TRAIL_STRIDE
    out[o] = pt.x
    out[o + 1] = pt.y
    out[o + 2] = pt.z
    out[o + 3] = pt.heading
    out[o + 4] = x
    prev = smp.i
    n++
  }
  return n >= 2 ? n : 0
}

/**
 * Índice de la última muestra con instante ≤ `x` y de hace como mucho `maxAgeMs`; −1 si no hay (sin dato). La
 * muestra es la cruda, sin interpolar. `cursor.i` es la pista de búsqueda (coherencia temporal) y se actualiza.
 */
export function latestSample(times: Float64Array, x: number, cursor: { i: number }, maxAgeMs = MAX_SAMPLE_AGE_MS): number {
  if (times.length === 0) return -1
  const i = findInterval(times, x, cursor.i)
  cursor.i = Math.max(0, i)
  if (i < 0 || x - times[i]! > maxAgeMs) return -1
  return i
}

/** Fracción 0–1 de una velocidad (km/h) en la escala fija del color por velocidad. */
export function speedFraction(kmh: number): number {
  const { min, max } = TRAIL_SPEED_KMH
  if (!Number.isFinite(kmh)) return 0
  return Math.min(1, Math.max(0, (kmh - min) / (max - min)))
}

/** Opacidad de las estelas en el coche: la del coche elegido, algo más marcada. */
export const TRAIL_HEAD_ALPHA = 0.6
export const TRAIL_HEAD_ALPHA_SELECTED = 0.95

/** Opacidad de un punto según su antigüedad (0 = el coche, 1 = la cola de la estela): se desvanece hacia la cola. */
export function trailAlpha(age: number, head: number): number {
  const a = Math.min(1, Math.max(0, age))
  return head * (1 - a)
}
